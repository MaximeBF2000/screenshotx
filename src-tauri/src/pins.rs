//! Floating ("pinned") screenshots that stay above all windows.

use crate::displays;
use crate::macos;
use crate::state::{self, settings};
use crate::windows::{self, PanelKind, Spec};
use serde::Serialize;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinInfo {
    pub label: String,
    pub path: String,
    pub locked: bool,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
}

pub fn open(app: &AppHandle, path: &str) {
    if !std::path::Path::new(path).exists() {
        crate::toast::show(app, "error", "File not found", path);
        return;
    }
    let img = match image::image_dimensions(path) {
        Ok(d) => d,
        Err(_) => match crate::imageops::load(std::path::Path::new(path)) {
            Ok(i) => (i.width(), i.height()),
            Err(e) => {
                crate::toast::show(app, "error", "Could not pin image", &e.to_string());
                return;
            }
        },
    };
    let scale = if path.to_lowercase().ends_with(".png") { crate::imageops::png_scale(std::path::Path::new(path)) } else { 1.0 };
    let d = displays::under_mouse();
    let (vx, vy, vw, vh) = macos::visible_frame(app, d.id).unwrap_or((d.x, d.y, d.width, d.height));
    let mut w = img.0 as f64 / scale;
    let mut h = img.1 as f64 / scale;
    let max_w = vw * 0.8;
    let max_h = vh * 0.8;
    let r = (max_w / w).min(max_h / h).min(1.0);
    w *= r;
    h *= r;
    let (mx, my) = macos::mouse_location();
    let x = (mx - w / 2.0).clamp(vx, vx + vw - w);
    let y = (my - h / 2.0).clamp(vy, vy + vh - h);
    log::info!("pin {path}: image {:?} scale {scale} visible {:?} -> {w}x{h} at {x},{y}", img, (vx, vy, vw, vh));
    let label = format!("pin-{}", state::new_id());
    let mut spec = Spec::new(&label, "pin");
    spec.query = vec![("path", path.to_string()), ("scale", scale.to_string())];
    spec.width = w;
    spec.height = h;
    spec.pos = Some((x, y));
    spec.panel = Some(PanelKind::Key);
    spec.level = macos::Level::Floating;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = settings().pins_shadow;
    spec.visible = !state::state().pins_hidden.load(Ordering::SeqCst);
    if let Ok(win) = windows::create(app, spec) {
        log::info!("pin window frame: {:?} {:?}", win.outer_position(), win.outer_size());
        state::state().pins.lock().push(PinInfo { label: label.clone(), path: path.to_string(), locked: false, width: w, height: h, scale });
        windows::make_key(app, &label);
        crate::hover::track(app, &label);
        ensure_lock_monitor(app);
    }
}

pub fn close(app: &AppHandle, label: &str) {
    crate::hover::untrack(app, label);
    state::state().pins.lock().retain(|p| p.label != label);
    windows::close(app, label);
}

pub fn set_locked(app: &AppHandle, label: &str, locked: bool) {
    if let Some(p) = state::state().pins.lock().iter_mut().find(|p| p.label == label) {
        p.locked = locked;
    }
    windows::set_ignore_mouse(app, label, locked);
    if let Some(w) = app.get_webview_window(label) {
        let _ = w.emit_to(w.label(), "pin:locked", locked);
    }
}

pub fn toggle_visibility(app: &AppHandle) {
    let st = state::state();
    let hidden = !st.pins_hidden.load(Ordering::SeqCst);
    st.pins_hidden.store(hidden, Ordering::SeqCst);
    let pins = st.pins.lock().clone();
    for p in pins {
        if hidden {
            windows::hide(app, &p.label);
        } else if let Some(w) = app.get_webview_window(&p.label) {
            windows::show(app, &w, false);
        }
    }
}

pub fn close_all(app: &AppHandle) {
    let pins = state::state().pins.lock().clone();
    for p in pins {
        close(app, &p.label);
    }
}

static MONITOR: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Locked pins are click-through. While locked they fade when hovered (if
/// enabled) and holding ⌥ over one temporarily makes it interactive again.
fn ensure_lock_monitor(app: &AppHandle) {
    if MONITOR.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let mut faded: std::collections::HashSet<String> = Default::default();
        let mut peeking: std::collections::HashSet<String> = Default::default();
        loop {
            std::thread::sleep(std::time::Duration::from_millis(60));
            let pins: Vec<PinInfo> = state::state().pins.lock().iter().filter(|p| p.locked).cloned().collect();
            if pins.is_empty() && faded.is_empty() && peeking.is_empty() {
                if state::state().pins.lock().is_empty() {
                    MONITOR.store(false, Ordering::SeqCst);
                    return;
                }
                continue;
            }
            let (mx, my) = macos::mouse_location();
            let mods = macos::modifiers();
            let hide_on_hover = settings().pins_hide_on_hover_when_locked;
            for p in &pins {
                let Some(w) = app.get_webview_window(&p.label) else { continue };
                let (Ok(pos), Ok(size), Ok(sf)) = (w.outer_position(), w.outer_size(), w.scale_factor()) else { continue };
                let (x, y) = (pos.x as f64 / sf, pos.y as f64 / sf);
                let (ww, wh) = (size.width as f64 / sf, size.height as f64 / sf);
                let inside = mx >= x && mx <= x + ww && my >= y && my <= y + wh;
                if inside && mods.alt {
                    if peeking.insert(p.label.clone()) {
                        windows::set_ignore_mouse(&app, &p.label, false);
                        windows::set_alpha(&app, &p.label, 1.0);
                        faded.remove(&p.label);
                    }
                    continue;
                } else if peeking.remove(&p.label) {
                    windows::set_ignore_mouse(&app, &p.label, true);
                }
                if hide_on_hover {
                    if inside && faded.insert(p.label.clone()) {
                        windows::set_alpha(&app, &p.label, 0.08);
                    } else if !inside && faded.remove(&p.label) {
                        windows::set_alpha(&app, &p.label, 1.0);
                    }
                }
            }
            // pins that were unlocked meanwhile: restore alpha
            let locked: std::collections::HashSet<String> = pins.iter().map(|p| p.label.clone()).collect();
            faded.retain(|l| {
                if !locked.contains(l) {
                    windows::set_alpha(&app, l, 1.0);
                    false
                } else {
                    true
                }
            });
            peeking.retain(|l| locked.contains(l));
        }
    });
}
