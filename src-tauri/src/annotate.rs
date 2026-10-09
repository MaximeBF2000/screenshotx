//! Annotate editor windows and the hidden renderer used to auto-apply a
//! Background Tool preset to new screenshots.

use crate::displays;
use crate::macos;
use crate::state::{self, settings, CaptureItem};
use crate::windows::{self, Spec};
use std::collections::HashMap;
use tauri::AppHandle;

static PENDING_RENDER: parking_lot::Mutex<Option<HashMap<String, (CaptureItem, Option<String>)>>> =
    parking_lot::Mutex::new(None);

pub fn open(app: &AppHandle, path: &str, capture_id: Option<String>) {
    if !path.is_empty() && !std::path::Path::new(path).exists() {
        crate::toast::show(app, "error", "File not found", path);
        return;
    }
    let (iw, ih, scale) = if path.ends_with(".screenshotx") {
        (1200.0, 800.0, 1.0)
    } else {
        let dims = image::image_dimensions(path).map(|(w, h)| (w as f64, h as f64)).unwrap_or((1200.0, 800.0));
        let scale = if path.to_lowercase().ends_with(".png") { crate::imageops::png_scale(std::path::Path::new(path)) } else { 1.0 };
        (dims.0, dims.1, scale)
    };
    let d = displays::under_mouse();
    let (_, _, vw, vh) = macos::visible_frame(app, d.id).unwrap_or((d.x, d.y, d.width, d.height));
    let chrome_w = 80.0;
    let chrome_h = 150.0;
    let mut w = iw / scale + chrome_w;
    let mut h = ih / scale + chrome_h;
    let r = ((vw * 0.86) / w).min((vh * 0.86) / h).min(1.0);
    w = (w * r).max(860.0);
    h = (h * r).max(560.0);
    let label = format!("annotate-{}", state::new_id());
    let mut spec = Spec::new(&label, "annotate");
    spec.title = "Annotate";
    spec.query = vec![("path", path.to_string()), ("captureId", capture_id.unwrap_or_default())];
    spec.width = w;
    spec.height = h;
    spec.min_size = Some((760.0, 480.0));
    spec.overlay_titlebar = true;
    spec.visible = false;
    if let Ok(win) = windows::create(app, spec) {
        if settings().annotate_always_on_top {
            let _ = win.set_always_on_top(true);
        }
    }
}

pub fn open_blank(app: &AppHandle) {
    open(app, "", None);
}

pub fn render_with_preset(app: &AppHandle, item: CaptureItem, action: Option<String>) {
    let s = settings();
    let id = item.id.clone();
    let path = item.path.clone();
    PENDING_RENDER.lock().get_or_insert_with(HashMap::new).insert(id.clone(), (item, action));
    let label = format!("renderer-{id}");
    let mut spec = Spec::new(&label, "renderer");
    spec.query = vec![("path", path), ("itemId", id), ("presetId", s.auto_background_preset_id.clone())];
    spec.width = 400.0;
    spec.height = 300.0;
    spec.visible = false;
    spec.pos = Some((-10000.0, -10000.0));
    let _ = windows::create(app, spec);
}

/// Called by the renderer with the composited PNG (or None on failure).
pub fn renderer_done(app: &AppHandle, item_id: &str, png: Option<Vec<u8>>) {
    let entry = PENDING_RENDER.lock().as_mut().and_then(|m| m.remove(item_id));
    windows::close(app, &format!("renderer-{item_id}"));
    let Some((mut item, action)) = entry else { return };
    if let Some(bytes) = png {
        if let Some(img) = crate::nativeimage::decode_bytes(&bytes) {
            let s = settings();
            if let Ok((data, _)) = crate::imageops::encode(&img, &s.screenshot_format, s.jpeg_quality, item.scale) {
                let _ = std::fs::write(&item.path, &data);
                item.width = img.width();
                item.height = img.height();
                item.size = data.len() as u64;
                item.thumb = crate::output::make_image_thumb(&img, std::path::Path::new(&item.path));
            }
        }
    }
    crate::output::run_actions(app, item, None, action);
}
