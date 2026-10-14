//! Recent captures and the ephemeral-capture cleanup.
//!
//! Captures live in `Captures/` only while something uses them: a Quick Access
//! card, a pin or an open editor. Once unused, they are deleted after a few
//! minutes ("Keep captures after closing" in Settings → Advanced), and every
//! capture is deleted when the app quits. Capture History lists the captures
//! that still exist; it is kept in memory only.

use crate::paths;
use crate::state::{self, settings, CaptureItem};
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::Mutex;
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Default)]
pub struct History {
    pub items: Vec<CaptureItem>,
}

/// How often `sweep` runs (lib.rs).
pub const SWEEP_INTERVAL: Duration = Duration::from_secs(15);

/// When each capture file was last seen in use.
static LAST_USED: Mutex<Option<HashMap<String, SystemTime>>> = Mutex::new(None);

pub fn add(app: &AppHandle, item: &CaptureItem) {
    state::state().history.lock().items.push(item.clone());
    let _ = app.emit("history:update", ());
}

/// Follow a capture whose file moved (saved to the export location, renamed).
pub fn update_path(id: &str, path: &str) {
    if let Some(it) = state::state().history.lock().items.iter_mut().find(|i| i.id == id) {
        if it.path == path {
            return;
        }
        it.path = path.to_string();
        it.saved = !Path::new(path).starts_with(paths::captures_dir());
    }
    let _ = state::app().emit("history:update", ());
}

pub fn find(id: &str) -> Option<CaptureItem> {
    state::state().history.lock().items.iter().find(|i| i.id == id && Path::new(&i.path).exists()).cloned()
}

pub fn latest() -> Option<CaptureItem> {
    state::state().history.lock().items.iter().rev().find(|i| Path::new(&i.path).exists()).cloned()
}

pub fn list() -> Vec<CaptureItem> {
    let mut v: Vec<CaptureItem> = state::state().history.lock().items.iter().filter(|i| Path::new(&i.path).exists()).cloned().collect();
    v.reverse();
    v
}

/// Forget a capture, deleting its file if it is still a temporary capture.
pub fn remove(app: &AppHandle, id: &str) {
    let removed = {
        let st = state::state();
        let mut h = st.history.lock();
        h.items.iter().position(|i| i.id == id).map(|p| h.items.remove(p))
    };
    if let Some(it) = removed {
        delete_capture(app, &it);
    }
    let _ = app.emit("history:update", ());
}

pub fn clear(app: &AppHandle) {
    let items: Vec<CaptureItem> = state::state().history.lock().items.drain(..).collect();
    for it in &items {
        delete_capture(app, it);
    }
    let _ = app.emit("history:update", ());
}

fn delete_capture(app: &AppHandle, it: &CaptureItem) {
    let in_use = files_in_use(app);
    if Path::new(&it.path).starts_with(paths::captures_dir()) && !in_use.contains(&it.path) {
        let _ = std::fs::remove_file(&it.path);
    }
    if !it.thumb.is_empty() && !in_use.contains(&it.thumb) {
        let _ = std::fs::remove_file(&it.thumb);
    }
}

/// Capture files (and thumbnails) used by Quick Access, pins or open windows.
fn files_in_use(app: &AppHandle) -> HashSet<String> {
    let st = state::state();
    let mut used: HashSet<String> = HashSet::new();
    for it in st.qa_items.lock().iter() {
        used.insert(it.path.clone());
        used.insert(it.thumb.clone());
        used.extend(it.project.clone());
    }
    for p in st.pins.lock().iter() {
        used.insert(p.path.clone());
    }
    // editors, video editor, renderer: the file is in the window's ?path=
    for w in app.webview_windows().values() {
        if let Ok(url) = w.url() {
            if let Some((_, p)) = url.query_pairs().find(|(k, _)| k == "path") {
                used.insert(p.to_string());
            }
        }
    }
    used
}

fn is_video(p: &Path) -> bool {
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    matches!(ext.as_str(), "mp4" | "mov" | "m4v" | "gif")
}

/// Delete captures that have been unused for longer than the retention setting.
pub fn sweep(app: &AppHandle) {
    let s = settings();
    // "last seen in use" can be up to one interval before the file stopped
    // being used, so never delete before the full delay has passed
    let keep_image = Duration::from_secs(s.keep_images_minutes as u64 * 60) + SWEEP_INTERVAL;
    let keep_video = Duration::from_secs(s.keep_videos_minutes as u64 * 60) + SWEEP_INTERVAL;
    let now = SystemTime::now();
    let in_use = files_in_use(app);
    let mut deleted = false;
    {
        let mut guard = LAST_USED.lock().unwrap();
        let last_used = guard.get_or_insert_with(HashMap::new);
        if let Ok(rd) = std::fs::read_dir(paths::captures_dir()) {
            for e in rd.flatten() {
                let path = e.path();
                if !path.is_file() {
                    continue;
                }
                let key = path.to_string_lossy().to_string();
                if in_use.contains(&key) {
                    last_used.insert(key, now);
                    continue;
                }
                let since = last_used
                    .get(&key)
                    .copied()
                    .or_else(|| e.metadata().and_then(|m| m.modified()).ok())
                    .unwrap_or(now);
                let keep = if is_video(&path) { keep_video } else { keep_image };
                if now.duration_since(since).unwrap_or_default() >= keep {
                    log::info!("ephemeral cleanup: {}", path.display());
                    let _ = std::fs::remove_file(&path);
                    last_used.remove(&key);
                    deleted = true;
                }
            }
        }
        last_used.retain(|k, _| Path::new(k).exists());
    }
    // forget history entries whose file is gone, then their thumbnails
    let gone: Vec<CaptureItem> = {
        let st = state::state();
        let mut h = st.history.lock();
        let (keep, gone): (Vec<_>, Vec<_>) = h.items.drain(..).partition(|i| Path::new(&i.path).exists());
        h.items = keep;
        gone
    };
    for it in &gone {
        if !it.thumb.is_empty() && !in_use.contains(&it.thumb) {
            let _ = std::fs::remove_file(&it.thumb);
        }
    }
    sweep_thumbnails(&in_use);
    if deleted || !gone.is_empty() {
        let _ = app.emit("history:update", ());
    }
}

/// Thumbnails nothing refers to anymore.
fn sweep_thumbnails(in_use: &HashSet<String>) {
    let referenced: HashSet<String> = {
        let st = state::state();
        let h = st.history.lock();
        let closed = st.qa_closed.lock();
        h.items.iter().chain(closed.iter()).map(|i| i.thumb.clone()).collect()
    };
    let minute_ago = SystemTime::now() - Duration::from_secs(60);
    if let Ok(rd) = std::fs::read_dir(paths::thumbs_dir()) {
        for e in rd.flatten() {
            let key = e.path().to_string_lossy().to_string();
            if in_use.contains(&key) || referenced.contains(&key) {
                continue;
            }
            if e.metadata().and_then(|m| m.modified()).map(|t| t < minute_ago).unwrap_or(false) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
}

/// Delete every capture and temporary file: runs when the app quits, and at
/// launch in case the last session didn't quit cleanly.
pub fn purge_all() {
    for dir in [paths::captures_dir(), paths::temp_dir()] {
        if let Ok(rd) = std::fs::read_dir(&dir) {
            for e in rd.flatten() {
                let p = e.path();
                let _ = if p.is_dir() { std::fs::remove_dir_all(&p) } else { std::fs::remove_file(&p) };
            }
        }
    }
    let st = state::state();
    st.history.lock().items.clear();
    st.qa_closed.lock().clear();
    log::info!("purged captures");
}
