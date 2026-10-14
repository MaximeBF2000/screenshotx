//! Turning captured pixels / recordings into files, and running the
//! "After capture" actions (Quick Access, copy, save, annotate, pin...).

use crate::capture::Context;
use crate::naming::{self, NameContext};
use crate::paths;
use crate::state::{self, settings, CaptureItem, CaptureKind};
use image::RgbaImage;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter};

pub fn file_stem(kind: &CaptureKind, ctx_app: &str, ctx_title: &str) -> String {
    let s = settings();
    let counter = s.auto_increment.max(1);
    let kind_name = match kind {
        CaptureKind::Screenshot => "Screenshot",
        CaptureKind::Video => "Recording",
        CaptureKind::Gif => "GIF",
    };
    let mut pattern = s.file_name_pattern.clone();
    if !matches!(kind, CaptureKind::Screenshot) && pattern.starts_with("Screenshot X ") {
        pattern = pattern.replacen("Screenshot X ", "Screenshot X Recording ", 1);
    }
    let name = naming::expand(
        &pattern,
        &NameContext { app_name: ctx_app, window_title: ctx_title, counter, kind: kind_name },
        s.use_utc,
        s.remove_illegal_chars,
    );
    if naming::uses_counter(&s.file_name_pattern) {
        state::update_settings(|st| st.auto_increment = st.auto_increment.max(1).saturating_add(1));
    }
    name
}

pub fn finish_screenshot(app: &AppHandle, mut img: RgbaImage, mut scale: f64, ctx: Context) {
    let s = settings();
    // "Add New Screenshot" from Annotate — hand the image straight back.
    if let Some(label) = ctx.deliver_to.clone() {
        let path = paths::unique_path(&paths::temp_dir(), &state::new_id(), "png");
        if let Ok(bytes) = crate::imageops::encode_png(&img, scale) {
            let _ = crate::imageops::write_file(&path, &bytes);
            let _ = app.emit_to(&label, "annotate:add-image", path.to_string_lossy().to_string());
            crate::windows::make_key(app, &label);
        }
        return;
    }
    if s.scale_retina_to_1x && scale > 1.0 {
        let w = (img.width() as f64 / scale).round() as u32;
        let h = (img.height() as f64 / scale).round() as u32;
        img = crate::imageops::scale_to(&img, w, h);
        scale = 1.0;
    }
    if s.add_border {
        img = crate::imageops::add_border(&img, [0, 0, 0, 46]);
    }
    if s.play_sounds {
        crate::macos::play_sound(app, &s.shutter_sound);
    }
    let fmt = if s.screenshot_format == "jpg" && img.pixels().any(|p| p[3] < 255) {
        "png".to_string() // keep transparency of window shots
    } else {
        s.screenshot_format.clone()
    };
    let (bytes, ext) = match crate::imageops::encode(&img, &fmt, s.jpeg_quality, scale) {
        Ok(v) => v,
        Err(e) => {
            crate::toast::show(app, "error", "Could not encode screenshot", &e.to_string());
            return;
        }
    };
    let mut stem = file_stem(&CaptureKind::Screenshot, &ctx.app_name, &ctx.window_title);
    if s.add_retina_suffix && scale > 1.0 {
        stem.push_str(&format!("@{}x", scale.round() as u32));
    }
    let path = paths::unique_path(&paths::captures_dir(), &stem, ext);
    if let Err(e) = crate::imageops::write_file(&path, &bytes) {
        crate::toast::show(app, "error", "Could not write file", &e.to_string());
        return;
    }
    let thumb = make_image_thumb(&img, &path);
    let item = CaptureItem {
        id: state::new_id(),
        kind: CaptureKind::Screenshot,
        path: path.to_string_lossy().to_string(),
        width: img.width(),
        height: img.height(),
        scale,
        created: state::now_ms(),
        size: bytes.len() as u64,
        duration: None,
        thumb,
        saved: false,
        app_name: ctx.app_name.clone(),
        ocr_text: None,
        project: None,
    };
    if s.auto_apply_background_preset && !s.auto_background_preset_id.is_empty() {
        // Rendered by the (hidden) annotate renderer, which then calls back
        // `renderer_done` to continue with the after-capture actions.
        crate::annotate::render_with_preset(app, item, ctx.action);
        return;
    }
    run_actions(app, item, Some(&img), ctx.action);
}

pub fn make_image_thumb(img: &RgbaImage, path: &Path) -> String {
    let t = crate::imageops::thumbnail(img, 640);
    let tp = paths::thumbs_dir().join(format!(
        "{}.jpg",
        path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(state::new_id) + "-" + &state::new_id()
    ));
    if let Ok(b) = crate::imageops::encode_jpeg(&t, 85) {
        let _ = std::fs::write(&tp, b);
    }
    tp.to_string_lossy().to_string()
}

/// Which actions to run, honoring per-shortcut / URL-scheme overrides.
fn resolve_actions(kind: &CaptureKind, action: &Option<String>) -> crate::settings::AfterCapture {
    let s = settings();
    let mut ac = if matches!(kind, CaptureKind::Screenshot) { s.after_screenshot.clone() } else { s.after_recording.clone() };
    if let Some(a) = action {
        if s.ignore_after_capture_for_specific_shortcuts {
            ac = crate::settings::AfterCapture {
                show_quick_access: false,
                copy_to_clipboard: false,
                save: false,
                open_annotate: false,
                open_video_editor: false,
                pin: false,
            };
        }
        match a.as_str() {
            "copy" => ac.copy_to_clipboard = true,
            "save" => ac.save = true,
            "annotate" => ac.open_annotate = true,
            "pin" => ac.pin = true,
            "upload" => ac.show_quick_access = true,
            "quickaccess" => ac.show_quick_access = true,
            "editor" => ac.open_video_editor = true,
            _ => {}
        }
    }
    ac
}

pub fn run_actions(app: &AppHandle, mut item: CaptureItem, img: Option<&RgbaImage>, action: Option<String>) {
    let s = settings();
    let ac = resolve_actions(&item.kind, &action);
    crate::history::add(app, &item);
    if ac.save {
        match save_to_export_location(&item) {
            Ok(p) => {
                item.path = p.to_string_lossy().to_string();
                item.saved = true;
            }
            Err(e) => crate::toast::show(app, "error", "Could not save", &e.to_string()),
        }
    }
    if ac.copy_to_clipboard {
        crate::clipboard::copy_capture(Path::new(&item.path), img, &s.clipboard_content);
    }
    *state::state().last_capture.lock() = Some(item.clone());
    let mut shown = false;
    if ac.show_quick_access {
        crate::quick_access::add(app, item.clone());
        shown = true;
    }
    match item.kind {
        CaptureKind::Screenshot => {
            if ac.open_annotate {
                crate::annotate::open(app, &item.path, Some(item.id.clone()));
                shown = true;
            }
            if ac.pin {
                crate::pins::open(app, &item.path);
                shown = true;
            }
        }
        _ => {
            if ac.open_video_editor || s.rec_open_editor_after {
                crate::video::open_editor(app, &item.path);
                shown = true;
            }
        }
    }
    if !shown && !ac.save && !ac.copy_to_clipboard {
        // Nothing would happen: at least keep the file reachable.
        crate::quick_access::add(app, item.clone());
    } else if ac.save && !ac.show_quick_access && !ac.copy_to_clipboard && !ac.open_annotate && !ac.pin {
        crate::toast::show(app, "saved", "Screenshot saved", &item.file_name());
    } else if ac.copy_to_clipboard && !ac.show_quick_access && !ac.open_annotate && !ac.pin {
        crate::toast::show(
            app,
            "copied",
            if matches!(item.kind, CaptureKind::Screenshot) { "Screenshot copied" } else { "Recording copied" },
            "",
        );
    }
    // Temporary capture files nobody references anymore are cleaned up
    // when the Quick Access item closes (history keeps its own copy).
    if !ac.show_quick_access && !item.saved && (ac.copy_to_clipboard || ac.open_annotate || ac.pin) {
        // keep the file: the clipboard (file URL), annotate and pins use it.
    }
}

/// File extension for a "screenshot format" setting value.
pub fn image_extension(format: &str) -> &'static str {
    match format {
        "jpg" | "jpeg" => "jpg",
        "heic" => "heic",
        "webp" => "webp",
        _ => "png",
    }
}

/// A Quick Access item for a file that's already on disk (None if missing).
pub fn file_item(path: &str) -> Option<CaptureItem> {
    let p = Path::new(path);
    if !p.exists() {
        return None;
    }
    let ext = p.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default();
    let is_video = matches!(ext.as_str(), "mp4" | "mov" | "m4v");
    let (width, height) = if is_video { (0, 0) } else { image::image_dimensions(p).unwrap_or((0, 0)) };
    let thumb = if is_video {
        crate::video::thumbnail(p).unwrap_or_default()
    } else {
        crate::imageops::load(p).map(|i| make_image_thumb(&i, p)).unwrap_or_default()
    };
    Some(CaptureItem {
        id: state::new_id(),
        kind: if is_video { CaptureKind::Video } else if ext == "gif" { CaptureKind::Gif } else { CaptureKind::Screenshot },
        path: path.to_string(),
        width,
        height,
        scale: if ext == "png" { crate::imageops::png_scale(p) } else { 1.0 },
        created: state::now_ms(),
        size: std::fs::metadata(p).map(|m| m.len()).unwrap_or(0),
        duration: if is_video { crate::video::duration(p) } else { None },
        thumb,
        // files in our capture / temp folders are deleted unless saved
        saved: !p.starts_with(paths::captures_dir()) && !p.starts_with(paths::temp_dir()),
        app_name: String::new(),
        ocr_text: None,
        project: None,
    })
}

pub fn export_dir() -> PathBuf {
    let s = settings();
    let p = paths::expand_tilde(&s.export_location);
    let _ = std::fs::create_dir_all(&p);
    p
}

/// Copy a capture to the export location; returns the new path.
pub fn save_to_export_location(item: &CaptureItem) -> anyhow::Result<PathBuf> {
    save_to_dir(item, &export_dir())
}

pub fn save_to_dir(item: &CaptureItem, dir: &Path) -> anyhow::Result<PathBuf> {
    let src = Path::new(&item.path);
    if src.parent() == Some(dir) {
        return Ok(src.to_path_buf());
    }
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "Screenshot X".into());
    let ext = src.extension().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "png".into());
    let dst = paths::unique_path(dir, &stem, &ext);
    std::fs::copy(src, &dst)?;
    if src.starts_with(paths::captures_dir()) {
        let _ = std::fs::remove_file(src);
    }
    Ok(dst)
}

/// Finish a recording (video or GIF) file.
pub fn finish_recording(app: &AppHandle, path: PathBuf, kind: CaptureKind, width: u32, height: u32, duration: f64, ctx_app: String) {
    let s = settings();
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    let thumb = crate::video::thumbnail(&path).unwrap_or_default();
    let item = CaptureItem {
        id: state::new_id(),
        kind,
        path: path.to_string_lossy().to_string(),
        width,
        height,
        scale: 1.0,
        created: state::now_ms(),
        size,
        duration: Some(duration),
        thumb,
        saved: false,
        app_name: ctx_app,
        ocr_text: None,
        project: None,
    };
    if s.play_sounds {
        crate::macos::play_sound(app, "stop");
    }
    run_actions(app, item, None, None);
}
