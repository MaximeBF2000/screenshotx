//! Small HUD notifications ("Text has been copied", errors, link prompts).

use crate::displays;
use crate::macos;
use crate::windows::{self, PanelKind, Spec};
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};

pub const LABEL: &str = "toast";
const W: f64 = 380.0;
const H: f64 = 140.0;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToastAction {
    pub id: String,
    pub label: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Toast {
    pub id: String,
    /// copied | saved | error | info | link | ocr
    pub kind: String,
    pub title: String,
    pub body: String,
    pub actions: Vec<ToastAction>,
    pub duration_ms: u64,
}

pub fn show(app: &AppHandle, kind: &str, title: &str, body: &str) {
    present(
        app,
        Toast {
            id: crate::state::new_id(),
            kind: kind.into(),
            title: title.into(),
            body: body.into(),
            actions: vec![],
            duration_ms: if kind == "error" { 5000 } else { 2200 },
        },
    );
}

pub fn present(app: &AppHandle, toast: Toast) {
    let d = displays::under_mouse();
    let (vx, vy, vw, _vh) = macos::visible_frame(app, d.id).unwrap_or((d.x, d.y, d.width, d.height));
    let x = vx + vw / 2.0 - W / 2.0;
    let y = vy + 12.0;
    let win = match app.get_webview_window(LABEL) {
        Some(w) => w,
        None => {
            let mut spec = Spec::new(LABEL, "toast");
            spec.width = W;
            spec.height = H;
            spec.pos = Some((x, y));
            spec.panel = Some(PanelKind::Key);
            spec.level = macos::Level::Overlay;
            spec.transparent = true;
            spec.decorations = false;
            spec.resizable = false;
            spec.shadow = false;
            spec.visible = false;
            match windows::create(app, spec) {
                Ok(w) => w,
                Err(_) => return,
            }
        }
    };
    macos::set_frame_cg(app, &win, x, y, W, H);
    // stash for the webview to pull if it was just created
    *PENDING.lock() = Some(toast.clone());
    let _ = win.emit_to(win.label(), "toast:show", &toast);
    windows::show(app, &win, false);
}

static PENDING: parking_lot::Mutex<Option<Toast>> = parking_lot::Mutex::new(None);

pub fn pending() -> Option<Toast> {
    PENDING.lock().clone()
}

pub fn hide(app: &AppHandle) {
    *PENDING.lock() = None;
    windows::hide(app, LABEL);
}
