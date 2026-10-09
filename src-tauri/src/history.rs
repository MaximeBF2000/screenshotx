//! Capture History: a private copy of every capture, kept for N days.

use crate::paths;
use crate::state::{self, settings, CaptureItem};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::{AppHandle, Emitter};

#[derive(Default, Serialize, Deserialize)]
pub struct History {
    pub items: Vec<CaptureItem>,
}

fn index_path() -> std::path::PathBuf {
    paths::config_dir().join("history.json")
}

impl History {
    pub fn load() -> Self {
        let mut h: History = std::fs::read_to_string(index_path())
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default();
        h.items.retain(|i| Path::new(&i.path).exists());
        h
    }
    pub fn save(&self) {
        if let Ok(s) = serde_json::to_string(self) {
            let _ = std::fs::write(index_path(), s);
        }
    }
}

pub fn add(app: &AppHandle, item: &CaptureItem) {
    let src = Path::new(&item.path);
    let dir = paths::history_dir().join(&item.id);
    let _ = std::fs::create_dir_all(&dir);
    let dst = dir.join(src.file_name().unwrap_or_default());
    if std::fs::hard_link(src, &dst).is_err() {
        let _ = std::fs::copy(src, &dst);
    }
    let mut copy = item.clone();
    copy.path = dst.to_string_lossy().to_string();
    copy.saved = true;
    {
        let st = state::state();
        let mut h = st.history.lock();
        h.items.push(copy);
        h.save();
    }
    let _ = app.emit("history:update", ());
}

pub fn find(id: &str) -> Option<CaptureItem> {
    state::state().history.lock().items.iter().find(|i| i.id == id).cloned()
}

pub fn latest() -> Option<CaptureItem> {
    state::state().history.lock().items.last().cloned()
}

pub fn list() -> Vec<CaptureItem> {
    let mut v = state::state().history.lock().items.clone();
    v.reverse();
    v
}

pub fn remove(app: &AppHandle, id: &str) {
    {
        let st = state::state();
        let mut h = st.history.lock();
        if let Some(pos) = h.items.iter().position(|i| i.id == id) {
            let it = h.items.remove(pos);
            let _ = std::fs::remove_dir_all(paths::history_dir().join(&it.id));
            if !it.thumb.is_empty() {
                let _ = std::fs::remove_file(&it.thumb);
            }
        }
        h.save();
    }
    let _ = app.emit("history:update", ());
}

pub fn clear(app: &AppHandle) {
    {
        let st = state::state();
        let mut h = st.history.lock();
        for it in h.items.drain(..) {
            let _ = std::fs::remove_dir_all(paths::history_dir().join(&it.id));
        }
        h.save();
    }
    let _ = app.emit("history:update", ());
}

/// Drop entries older than the "Keep history" setting.
pub fn prune(app: &AppHandle) {
    let days = settings().history_days;
    if days == 0 {
        clear(app);
        return;
    }
    let cutoff = state::now_ms() - days as i64 * 86_400_000;
    let old: Vec<String> = state::state()
        .history
        .lock()
        .items
        .iter()
        .filter(|i| i.created < cutoff)
        .map(|i| i.id.clone())
        .collect();
    for id in old {
        remove(app, &id);
    }
    // clean temp files and unreferenced captures older than two days
    let day_ago = std::time::SystemTime::now() - std::time::Duration::from_secs(86_400 * 2);
    let in_use: Vec<String> = state::state().qa_items.lock().iter().map(|i| i.path.clone()).collect();
    let pinned: Vec<String> = state::state().pins.lock().iter().map(|p| p.path.clone()).collect();
    if let Ok(rd) = std::fs::read_dir(paths::captures_dir()) {
        for e in rd.flatten() {
            let p = e.path().to_string_lossy().to_string();
            if in_use.contains(&p) || pinned.contains(&p) {
                continue;
            }
            if e.metadata().and_then(|m| m.modified()).map(|t| t < day_ago).unwrap_or(false) {
                let _ = std::fs::remove_file(e.path());
            }
        }
    }
    for dir in [paths::temp_dir()] {
        if let Ok(rd) = std::fs::read_dir(dir) {
            for e in rd.flatten() {
                if e.metadata().and_then(|m| m.modified()).map(|t| t < day_ago).unwrap_or(false) {
                    // filmstrip folders and temp files alike
                    if e.path().is_dir() {
                        let _ = std::fs::remove_dir_all(e.path());
                    } else {
                        let _ = std::fs::remove_file(e.path());
                    }
                }
            }
        }
    }
}
