//! Quick Access Overlay: the stack of capture thumbnails in a screen corner.

use crate::displays;
use crate::macos;
use crate::state::{self, settings, CaptureItem, CaptureKind};
use crate::windows::{self, PanelKind, Spec};
use serde::Serialize;
use std::path::Path;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

pub const LABEL: &str = "quickaccess";
const CARD_W: f64 = 228.0;
const CARD_H: f64 = 148.0;
const GAP: f64 = 14.0;
const MARGIN: f64 = 18.0;
const TOP_BAR: f64 = 44.0;
const SIDE_PAD: f64 = 22.0;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Layout {
    pub card_w: f64,
    pub card_h: f64,
    pub gap: f64,
    pub top_bar: f64,
    pub side_pad: f64,
    pub side: String,
}

fn layout() -> Layout {
    let s = settings();
    Layout {
        card_w: (CARD_W * s.qa_size).round(),
        card_h: (CARD_H * s.qa_size).round(),
        gap: GAP,
        top_bar: TOP_BAR,
        side_pad: SIDE_PAD,
        side: s.qa_position.clone(),
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct QaState {
    pub items: Vec<CaptureItem>,
    pub layout: Layout,
    pub auto_close: bool,
    pub auto_close_interval: u32,
    pub ask_name: bool,
    pub show_info: bool,
    pub can_restore: bool,
}

pub fn current_state() -> QaState {
    let s = settings();
    let st = state::state();
    let items = st.qa_items.lock().clone();
    let can_restore = !st.qa_closed.lock().is_empty();
    QaState {
        items,
        layout: layout(),
        auto_close: s.qa_auto_close,
        auto_close_interval: s.qa_auto_close_interval,
        ask_name: s.ask_for_name_after_capture,
        show_info: s.qa_show_file_info,
        can_restore,
    }
}

pub fn prewarm(app: &AppHandle) {
    let _ = ensure(app);
}

fn ensure(app: &AppHandle) -> Option<tauri::WebviewWindow> {
    if let Some(w) = app.get_webview_window(LABEL) {
        return Some(w);
    }
    let mut spec = Spec::new(LABEL, "quickaccess");
    spec.width = CARD_W + SIDE_PAD * 2.0;
    spec.height = CARD_H + TOP_BAR;
    spec.pos = Some((0.0, 0.0));
    spec.panel = Some(PanelKind::Key);
    spec.level = macos::Level::Floating;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    spec.visible = false;
    windows::create(app, spec).ok()
}

/// Resize/position the overlay window to fit the current stack.
pub fn relayout(app: &AppHandle) {
    relayout_animated(app, false);
}

fn relayout_animated(app: &AppHandle, animate: bool) {
    let Some(w) = ensure(app) else { return };
    let st = state::state();
    let n = st.qa_items.lock().len();
    if n == 0 || st.qa_hidden.load(Ordering::SeqCst) {
        crate::hover::untrack(app, LABEL);
        windows::hide(app, LABEL);
        let _ = w.emit_to(w.label(), "qa:update", current_state());
        return;
    }
    let s = settings();
    let l = layout();
    let d = if s.qa_move_to_active_screen { displays::under_mouse() } else { displays::list()[0].clone() };
    let (vx, vy, vw, vh) = macos::visible_frame(app, d.id).unwrap_or((d.x, d.y, d.width, d.height));
    let content_h = n as f64 * (l.card_h + l.gap) + l.top_bar;
    let height = content_h.min(vh - MARGIN);
    let width = l.card_w + l.side_pad * 2.0;
    let x = if s.qa_position == "right" { vx + vw - width - MARGIN + l.side_pad } else { vx + MARGIN - l.side_pad };
    let y = vy + vh - height - MARGIN + l.gap;
    if animate {
        macos::animate_frame_cg(app, &w, x, y, width, height);
    } else {
        macos::set_frame_cg(app, &w, x, y, width, height);
    }
    let _ = w.emit_to(w.label(), "qa:update", current_state());
    windows::show(app, &w, false);
    crate::hover::track(app, LABEL);
    follow_active_screen(app);
}

pub fn add(app: &AppHandle, item: CaptureItem) {
    let st = state::state();
    st.qa_hidden.store(false, Ordering::SeqCst);
    st.qa_items.lock().push(item);
    relayout(app);
}

pub fn find(id: &str) -> Option<CaptureItem> {
    state::state().qa_items.lock().iter().find(|i| i.id == id).cloned()
}

fn update_item(id: &str, f: impl FnOnce(&mut CaptureItem)) {
    if let Some(i) = state::state().qa_items.lock().iter_mut().find(|i| i.id == id) {
        f(i);
    }
}

pub fn close(app: &AppHandle, id: &str, remember: bool) {
    close_inner(app, id, remember, true);
}

/// Close a card whose file was handed to another window (Annotate, Video
/// Editor, pin): the file must survive; stale captures are pruned later.
pub fn close_keep_file(app: &AppHandle, id: &str) {
    close_inner(app, id, true, false);
}

fn close_inner(app: &AppHandle, id: &str, remember: bool, discard: bool) {
    let removed = {
        let st = state::state();
        let mut items = st.qa_items.lock();
        let pos = items.iter().position(|i| i.id == id);
        pos.map(|p| items.remove(p))
    };
    if let Some(item) = removed {
        if remember {
            let st = state::state();
            let mut closed = st.qa_closed.lock();
            closed.push(item.clone());
            if closed.len() > 20 {
                closed.remove(0);
            }
        }
        // Temp files go away; history keeps its own copy for restoring.
        if discard && !item.saved {
            crate::output::discard_if_temp(&item);
        }
    }
    relayout(app);
}

pub fn close_all(app: &AppHandle) {
    let ids: Vec<String> = state::state().qa_items.lock().iter().map(|i| i.id.clone()).collect();
    for id in ids {
        close(app, &id, true);
    }
}

pub fn save_all(app: &AppHandle) {
    let ids: Vec<String> = state::state().qa_items.lock().iter().map(|i| i.id.clone()).collect();
    for id in &ids {
        if let Some(item) = find(id) {
            if !item.saved {
                if let Ok(p) = crate::output::save_to_export_location(&item) {
                    update_item(id, |i| {
                        i.path = p.to_string_lossy().to_string();
                        i.saved = true;
                    });
                }
            }
        }
    }
    for id in ids {
        close(app, &id, true);
    }
    crate::toast::show(app, "saved", "All captures saved", "");
}

/// Restore the most recently closed overlay (or the last history entry).
pub fn restore(app: &AppHandle) {
    let item = state::state().qa_closed.lock().pop();
    let item = match item {
        Some(mut it) => {
            if !Path::new(&it.path).exists() {
                // the temp file was removed: restore from history copy
                if let Some(h) = crate::history::find(&it.id) {
                    it.path = h.path.clone();
                    it.saved = true;
                }
            }
            Some(it)
        }
        None => crate::history::latest().map(|mut h| {
            h.saved = true;
            h
        }),
    };
    match item {
        Some(it) if Path::new(&it.path).exists() => add(app, it),
        _ => crate::toast::show(app, "info", "No files to restore...", "Screenshot X couldn't find any recent captures to restore."),
    }
}

pub fn set_hidden(app: &AppHandle, hidden: bool) {
    state::state().qa_hidden.store(hidden, Ordering::SeqCst);
    relayout(app);
}

/// Hide temporarily; comes back on the next capture or after `secs`.
pub fn hide_temporarily(app: &AppHandle, secs: u64) {
    set_hidden(app, true);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(secs));
        if state::state().qa_hidden.load(Ordering::SeqCst) {
            set_hidden(&app, false);
        }
    });
}

pub fn action(app: &AppHandle, id: &str, action: &str, arg: Option<String>) -> Result<serde_json::Value, String> {
    let item = find(id).ok_or("item not found")?;
    let s = settings();
    match action {
        "copy" => {
            crate::clipboard::copy_capture(Path::new(&item.path), None, &s.clipboard_content);
            return Ok(serde_json::json!({"toast": "Copied"}));
        }
        "save" => {
            let p = crate::output::save_to_export_location(&item).map_err(|e| e.to_string())?;
            update_item(id, |i| {
                i.path = p.to_string_lossy().to_string();
                i.saved = true;
            });
            close(app, id, true);
        }
        "saveTo" => {
            // arg = chosen file path from the save dialog
            let dst = arg.ok_or("no destination")?;
            std::fs::copy(&item.path, &dst).map_err(|e| e.to_string())?;
            update_item(id, |i| {
                i.path = dst.clone();
                i.saved = true;
            });
            close(app, id, true);
        }
        // editing keeps the card; Annotate updates it when saving
        "annotate" => crate::annotate::open(app, &item.path, Some(item.id.clone())),
        "editor" => crate::video::open_editor(app, &item.path),
        "pin" => {
            crate::pins::open(app, &item.path);
            close_keep_file(app, id);
        }
        "reveal" => {
            if !item.saved {
                // Reveal requires a stable location: save first.
                let p = crate::output::save_to_export_location(&item).map_err(|e| e.to_string())?;
                update_item(id, |i| {
                    i.path = p.to_string_lossy().to_string();
                    i.saved = true;
                });
                macos::reveal_in_finder(&p.to_string_lossy());
            } else {
                macos::reveal_in_finder(&item.path);
            }
        }
        "open" => macos::open_path(&item.path),
        "quicklook" => crate::quicklook::preview(&item.path),
        "close" => close(app, id, true),
        "autoclose" => {
            if s.qa_auto_close_action == "saveAndClose" && !item.saved {
                if let Ok(p) = crate::output::save_to_export_location(&item) {
                    update_item(id, |i| {
                        i.path = p.to_string_lossy().to_string();
                        i.saved = true;
                    });
                }
            }
            close(app, id, true);
        }
        "dragged" => {
            // the drop target may still be reading the file: keep it
            if s.qa_close_after_dragging {
                close_keep_file(app, id);
            }
        }
        "delete" => {
            let _ = std::fs::remove_file(&item.path);
            crate::history::remove(app, id);
            close(app, id, false);
        }
        "rename" => {
            let name = crate::naming::sanitize(&arg.ok_or("no name")?, false);
            let p = Path::new(&item.path);
            let ext = p.extension().map(|e| e.to_string_lossy().to_string()).unwrap_or_default();
            let dst = p.with_file_name(format!("{name}.{ext}"));
            if dst != p {
                if dst.exists() {
                    return Err("A file with that name already exists".into());
                }
                std::fs::rename(p, &dst).map_err(|e| e.to_string())?;
                update_item(id, |i| i.path = dst.to_string_lossy().to_string());
                relayout(app);
            }
        }
        "share" => {
            if let Some(w) = app.get_webview_window(LABEL) {
                let (x, y) = arg
                    .and_then(|a| serde_json::from_str::<(f64, f64)>(&a).ok())
                    .unwrap_or((20.0, 20.0));
                macos::share_files(app, &w, vec![item.path.clone()], x, y);
            }
        }
        "rotateLeft" | "rotateRight" | "flipH" | "flipV" | "scale1x" => {
            let p = Path::new(&item.path);
            let img = crate::imageops::load(p).map_err(|e| e.to_string())?;
            let mut scale = item.scale;
            let out = match action {
                "rotateLeft" => image::imageops::rotate270(&img),
                "rotateRight" => image::imageops::rotate90(&img),
                "flipH" => image::imageops::flip_horizontal(&img),
                "flipV" => image::imageops::flip_vertical(&img),
                _ => {
                    if item.scale <= 1.0 {
                        return Ok(serde_json::json!({"toast": "Already at 1x"}));
                    }
                    let w = (img.width() as f64 / item.scale).round() as u32;
                    let h = (img.height() as f64 / item.scale).round() as u32;
                    scale = 1.0;
                    crate::imageops::scale_to(&img, w, h)
                }
            };
            let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
            let (bytes, _) = crate::imageops::encode(&out, &ext, s.jpeg_quality, scale).map_err(|e| e.to_string())?;
            std::fs::write(p, &bytes).map_err(|e| e.to_string())?;
            let thumb = crate::output::make_image_thumb(&out, p);
            update_item(id, |i| {
                i.width = out.width();
                i.height = out.height();
                i.scale = scale;
                i.size = bytes.len() as u64;
                i.thumb = thumb.clone();
            });
            relayout(app);
        }
        "gif" => {
            if item.kind == CaptureKind::Video {
                crate::video::convert_to_gif_async(app, item.path.clone());
            }
        }
        _ => return Err(format!("unknown action {action}")),
    }
    Ok(serde_json::Value::Null)
}

/// Annotate saved an edited version of a capture: point the card at it.
pub fn replace_file(app: &AppHandle, capture_id: &str, path: &str) {
    let p = Path::new(path);
    let Ok(img) = crate::imageops::load(p) else { return };
    let thumb = crate::output::make_image_thumb(&img, p);
    let size = std::fs::metadata(p).map(|m| m.len()).unwrap_or(0);
    let scale = if path.to_lowercase().ends_with(".png") { crate::imageops::png_scale(p) } else { 1.0 };
    update_item(capture_id, |i| {
        i.path = path.to_string();
        i.thumb = thumb.clone();
        i.width = img.width();
        i.height = img.height();
        i.scale = scale;
        i.size = size;
        i.saved = true;
    });
    relayout(app);
}

static FOLLOWING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Move the stack to the display the cursor is on (animated), like
/// CleanShot, while "Move to active screen" is enabled.
pub fn follow_active_screen(app: &AppHandle) {
    if FOLLOWING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut current = displays::under_mouse().id;
        loop {
            std::thread::sleep(std::time::Duration::from_millis(250));
            let st = state::state();
            if st.qa_items.lock().is_empty() {
                FOLLOWING.store(false, Ordering::SeqCst);
                return;
            }
            if !settings().qa_move_to_active_screen {
                continue;
            }
            let d = displays::under_mouse().id;
            if d != current {
                current = d;
                relayout_animated(&app, true);
            }
        }
    });
}
