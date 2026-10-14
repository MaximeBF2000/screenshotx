//! Tauri IPC commands used by the webviews.

use crate::capture::{self, Commit};
use crate::macos;
use crate::settings::Settings;
use crate::state::{self, settings, CaptureItem, CaptureKind};
use crate::windows;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow};

type CmdResult<T> = Result<T, String>;

fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

// ---------------- settings ----------------

#[tauri::command]
pub fn get_settings() -> Settings {
    settings()
}

#[tauri::command]
pub fn set_settings(app: AppHandle, patch: serde_json::Value) -> CmdResult<Settings> {
    let before = settings();
    let mut v = serde_json::to_value(&before).map_err(err)?;
    merge(&mut v, patch);
    let mut new: Settings = serde_json::from_value(v).map_err(err)?;
    // moving the data folder goes through set_storage_location (it moves files)
    new.storage_location = before.storage_location.clone();
    state::update_settings(|s| *s = new.clone());
    apply_side_effects(&app, &before, &new);
    Ok(new)
}

fn merge(a: &mut serde_json::Value, b: serde_json::Value) {
    match (a, b) {
        (serde_json::Value::Object(a), serde_json::Value::Object(b)) => {
            for (k, v) in b {
                // nested maps (shortcuts, after-capture) merge; others replace
                if v.is_object() && a.get(&k).map(|x| x.is_object()).unwrap_or(false) && k != "annotateLast" {
                    merge(a.get_mut(&k).unwrap(), v);
                } else {
                    a.insert(k, v);
                }
            }
        }
        (a, b) => *a = b,
    }
}

pub fn apply_side_effects(app: &AppHandle, before: &Settings, new: &Settings) {
    if before.shortcuts != new.shortcuts {
        crate::hotkeys::register_all(app);
    }
    if before.show_menu_bar_icon != new.show_menu_bar_icon {
        crate::tray::refresh(app);
        if !new.show_menu_bar_icon {
            crate::toast::show(app, "info", "The menu bar icon is hidden now.", "Launch Screenshot X again to open Settings.");
        }
    }
    if before.show_dock_icon != new.show_dock_icon {
        macos::set_activation_policy(app, new.show_dock_icon);
    }
    if before.launch_at_login != new.launch_at_login {
        use tauri_plugin_autostart::ManagerExt;
        let al = app.autolaunch();
        let _ = if new.launch_at_login { al.enable() } else { al.disable() };
    }
    if before.qa_position != new.qa_position || before.qa_size != new.qa_size {
        crate::quick_access::relayout(app);
    }
    if before.wallpaper_source != new.wallpaper_source
        || before.custom_wallpaper_path != new.custom_wallpaper_path
        || before.wallpaper_plain_color != new.wallpaper_plain_color
    {
        crate::desktop::invalidate_wallpaper_cache();
        if state::state().desktop_icons_hidden.load(std::sync::atomic::Ordering::SeqCst) {
            crate::desktop::set_hidden(app, true);
        }
    }
}

#[derive(Serialize)]
pub struct ActionInfo {
    id: &'static str,
    label: &'static str,
    group: &'static str,
    shortcut: String,
    display: String,
}

#[tauri::command]
pub fn get_actions() -> Vec<ActionInfo> {
    let s = settings();
    crate::actions::ACTIONS
        .iter()
        .map(|a| {
            let sc = s.shortcut(a.id).unwrap_or("").to_string();
            ActionInfo { id: a.id, label: a.label, group: a.group, display: crate::hotkeys::display(&sc), shortcut: sc }
        })
        .collect()
}

#[tauri::command]
pub fn shortcut_display(acc: String) -> String {
    crate::hotkeys::display(&acc)
}

#[tauri::command]
pub fn shortcuts_suspend(app: AppHandle, suspended: bool) {
    crate::hotkeys::suspend(&app, suspended);
}

#[tauri::command]
pub fn shortcut_available(app: AppHandle, acc: String) -> bool {
    crate::hotkeys::is_available(&app, &acc)
}

#[tauri::command]
pub fn run_action(app: AppHandle, id: String) {
    crate::actions::run(&app, &id);
}

// ---------------- windows ----------------

#[tauri::command]
pub fn window_ready(app: AppHandle, window: WebviewWindow) {
    let activate = !window.label().starts_with("renderer");
    if activate {
        windows::show(&app, &window, true);
    }
}

#[tauri::command]
pub fn close_window(app: AppHandle, label: String) {
    if label.starts_with("pin-") {
        crate::pins::close(&app, &label);
    } else {
        windows::close(&app, &label);
    }
}

#[tauri::command]
pub fn make_key(app: AppHandle, label: String) {
    windows::make_key(&app, &label);
}

#[tauri::command]
pub fn set_window_frame(app: AppHandle, window: WebviewWindow, x: f64, y: f64, w: f64, h: f64) {
    macos::set_frame_cg(&app, &window, x, y, w, h);
}

#[tauri::command]
pub fn window_frame(window: WebviewWindow) -> CmdResult<(f64, f64, f64, f64)> {
    let sf = window.scale_factor().map_err(err)?;
    let p = window.outer_position().map_err(err)?;
    let s = window.outer_size().map_err(err)?;
    Ok((p.x as f64 / sf, p.y as f64 / sf, s.width as f64 / sf, s.height as f64 / sf))
}

pub fn open_settings(app: &AppHandle, tab: Option<String>) {
    let label = "prefs";
    if let Some(w) = app.get_webview_window(label) {
        if let Some(t) = &tab {
            let _ = w.emit_to(w.label(), "prefs:tab", t);
        }
        windows::show(app, &w, true);
        return;
    }
    let mut spec = windows::Spec::new(label, "prefs");
    spec.title = "Screenshot X Settings";
    spec.width = 760.0;
    spec.height = 600.0;
    spec.resizable = false;
    spec.overlay_titlebar = true;
    spec.visible = false;
    if let Some(t) = tab {
        spec.query = vec![("tab", t)];
    }
    let _ = windows::create(app, spec);
}

pub fn open_history(app: &AppHandle) {
    let label = "history";
    if let Some(w) = app.get_webview_window(label) {
        windows::show(app, &w, true);
        return;
    }
    let mut spec = windows::Spec::new(label, "history");
    spec.title = "Capture History";
    spec.width = 980.0;
    spec.height = 680.0;
    spec.min_size = Some((620.0, 420.0));
    spec.overlay_titlebar = true;
    spec.visible = false;
    let _ = windows::create(app, spec);
}

#[tauri::command]
pub fn cmd_open_settings(app: AppHandle, tab: Option<String>) {
    open_settings(&app, tab);
}

#[tauri::command]
pub fn cmd_open_history(app: AppHandle) {
    open_history(&app);
}

// ---------------- capture overlay ----------------

#[tauri::command]
pub fn overlay_payload(app: AppHandle, display_id: u32) -> Option<capture::OverlayPayload> {
    capture::payload(&app, display_id)
}

#[tauri::command]
pub fn overlay_commit(app: AppHandle, commit: Commit) {
    capture::commit(&app, commit);
}

#[tauri::command]
pub fn overlay_cancel(app: AppHandle) {
    capture::cancel(&app);
}

#[tauri::command]
pub fn overlay_ready(app: AppHandle, display_id: u32, session_id: u64) {
    capture::overlay_ready(&app, display_id, session_id);
}

#[tauri::command]
pub fn overlay_focus(app: AppHandle, display_id: u32) {
    windows::make_key(&app, &capture::overlay_label(display_id));
}

#[tauri::command]
pub fn modifiers() -> macos::Modifiers {
    macos::modifiers()
}

#[tauri::command]
pub fn mouse_location() -> (f64, f64) {
    macos::mouse_location()
}

#[tauri::command]
pub fn list_displays() -> Vec<crate::displays::Display> {
    crate::displays::list()
}

// ---------------- quick access ----------------

#[tauri::command]
pub fn qa_state() -> crate::quick_access::QaState {
    crate::quick_access::current_state()
}

#[tauri::command]
pub fn qa_action(app: AppHandle, id: String, action: String, arg: Option<String>) -> CmdResult<serde_json::Value> {
    crate::quick_access::action(&app, &id, &action, arg)
}

#[tauri::command]
pub fn qa_close_all(app: AppHandle) {
    crate::quick_access::close_all(&app);
}

#[tauri::command]
pub fn qa_save_all(app: AppHandle) {
    crate::quick_access::save_all(&app);
}

#[tauri::command]
pub fn qa_restore(app: AppHandle) {
    crate::quick_access::restore(&app);
}

#[tauri::command]
pub fn qa_set_tucked(app: AppHandle, tucked: bool) {
    crate::quick_access::set_tucked(&app, tucked);
}

pub fn add_file_to_quick_access(app: &AppHandle, path: &str) {
    match crate::output::file_item(path) {
        Some(item) => crate::quick_access::add(app, item),
        None => crate::toast::show(app, "error", "File not found", path),
    }
}

// ---------------- toast ----------------

#[tauri::command]
pub fn toast_pending() -> Option<crate::toast::Toast> {
    crate::toast::pending()
}

#[tauri::command]
pub fn toast_hide(app: AppHandle) {
    crate::toast::hide(&app);
}

#[tauri::command]
pub fn toast_action(app: AppHandle, action: String) {
    if let Some(u) = action.strip_prefix("open-url:") {
        macos::open_url(u);
    } else if action == "never-open-links" {
        state::update_settings(|s| s.ocr_open_links = "never".into());
    } else if let Some(p) = action.strip_prefix("reveal:") {
        macos::reveal_in_finder(p);
    } else if let Some(p) = action.strip_prefix("qa:") {
        add_file_to_quick_access(&app, p);
    } else if action == "open-settings" {
        open_settings(&app, None);
    } else if let Some(p) = action.strip_prefix("editor:") {
        crate::video::open_editor(&app, p);
    }
    crate::toast::hide(&app);
}

// ---------------- pins ----------------

#[tauri::command]
pub fn pin_set_locked(app: AppHandle, label: String, locked: bool) {
    crate::pins::set_locked(&app, &label, locked);
}

#[tauri::command]
pub fn pin_open(app: AppHandle, path: String) {
    crate::pins::open(&app, &path);
}

// ---------------- history ----------------

#[tauri::command]
pub fn history_list() -> Vec<CaptureItem> {
    crate::history::list()
}

#[tauri::command]
pub fn history_action(app: AppHandle, id: String, action: String) -> CmdResult<()> {
    let item = crate::history::find(&id).ok_or("not found")?;
    let s = settings();
    match action.as_str() {
        "restore" => {
            let mut it = item.clone();
            it.saved = true;
            crate::quick_access::add(&app, it);
        }
        "copy" => crate::clipboard::copy_capture(Path::new(&item.path), None, &s.clipboard_content),
        "annotate" => crate::annotate::open(&app, &item.path, Some(item.id)),
        "editor" => crate::video::open_editor(&app, &item.path),
        "pin" => crate::pins::open(&app, &item.path),
        "reveal" => macos::reveal_in_finder(&item.path),
        "open" => macos::open_path(&item.path),
        "quicklook" => crate::quicklook::preview(&item.path),
        "save" => {
            let p = crate::output::save_to_export_location(&item).map_err(err)?;
            crate::toast::present(
                &app,
                crate::toast::Toast {
                    id: state::new_id(),
                    kind: "saved".into(),
                    title: "Saved to export location".into(),
                    body: p.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default(),
                    actions: vec![crate::toast::ToastAction { id: format!("reveal:{}", p.to_string_lossy()), label: "Show in Finder".into() }],
                    duration_ms: 3500,
                },
            );
        }
        "delete" => crate::history::remove(&app, &id),
        _ => return Err("unknown action".into()),
    }
    Ok(())
}

#[tauri::command]
pub fn history_clear(app: AppHandle) {
    crate::history::clear(&app);
}

// ---------------- files ----------------

#[tauri::command]
pub fn read_file_bytes(path: String) -> CmdResult<Response> {
    std::fs::read(&path).map(Response::new).map_err(err)
}

/// Raw body = file bytes; header `path` = destination.
#[tauri::command]
pub fn write_file_bytes(request: Request) -> CmdResult<()> {
    let path = request.headers().get("path").and_then(|v| v.to_str().ok()).map(|s| urlencoding::decode(s).map(|c| c.to_string()).unwrap_or_default()).ok_or("missing path")?;
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw body".into()) };
    crate::imageops::write_file(Path::new(&path), bytes).map_err(err)
}

/// Raw PNG body from the canvas; header `format` (png|jpg|heic|webp), `scale`.
/// Re-encodes in the requested format and writes to header `path` (or a
/// new temp capture file). Returns the written path.
#[tauri::command]
pub fn save_png_as(request: Request) -> CmdResult<String> {
    let h = |k: &str| request.headers().get(k).and_then(|v| v.to_str().ok()).map(|s| urlencoding::decode(s).map(|c| c.to_string()).unwrap_or_default());
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw body".into()) };
    let s = settings();
    let format = h("format").unwrap_or_else(|| s.screenshot_format.clone());
    let scale: f64 = h("scale").and_then(|v| v.parse().ok()).unwrap_or(1.0);
    let path = match h("path").filter(|p| !p.is_empty()) {
        Some(p) => std::path::PathBuf::from(p),
        None => {
            let stem = h("stem").unwrap_or_else(|| crate::output::file_stem(&CaptureKind::Screenshot, "", ""));
            let dir = match h("dir").as_deref() {
                Some("export") => crate::output::export_dir(),
                Some("temp") => crate::paths::temp_dir(),
                _ => crate::paths::captures_dir(),
            };
            crate::paths::unique_path(&dir, &stem, crate::output::image_extension(&format))
        }
    };
    let ext = path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_else(|| "png".into());
    if ext == "png" {
        // re-encode to embed the Retina DPI hint
        let img = crate::nativeimage::decode_bytes(bytes).ok_or("decode failed")?;
        let data = crate::imageops::encode_png(&img, scale).map_err(err)?;
        crate::imageops::write_file(&path, &data).map_err(err)?;
    } else {
        let img = crate::nativeimage::decode_bytes(bytes).ok_or("decode failed")?;
        let (data, _) = crate::imageops::encode(&img, &ext, s.jpeg_quality, scale).map_err(err)?;
        crate::imageops::write_file(&path, &data).map_err(err)?;
    }
    Ok(path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    Path::new(&path).exists()
}

#[tauri::command]
pub fn image_info(path: String) -> CmdResult<(u32, u32, f64)> {
    let p = Path::new(&path);
    let (w, h) = image::image_dimensions(p).map_err(err)?;
    let scale = if path.to_lowercase().ends_with(".png") { crate::imageops::png_scale(p) } else { 1.0 };
    Ok((w, h, scale))
}

#[tauri::command]
pub fn export_dir() -> String {
    crate::output::export_dir().to_string_lossy().to_string()
}

#[tauri::command]
pub fn new_file_stem(kind: Option<String>) -> String {
    let k = match kind.as_deref() {
        Some("video") => CaptureKind::Video,
        Some("gif") => CaptureKind::Gif,
        _ => CaptureKind::Screenshot,
    };
    crate::output::file_stem(&k, "", "")
}

#[tauri::command]
pub fn copy_file_to_clipboard(path: String) {
    crate::clipboard::copy_capture(Path::new(&path), None, &settings().clipboard_content);
}

#[tauri::command]
pub fn copy_text(text: String) {
    crate::clipboard::copy_text(&text);
}

#[tauri::command]
pub fn clipboard_image_png() -> CmdResult<Response> {
    let img = crate::clipboard::read_image().ok_or("no image")?;
    crate::imageops::encode_png(&img, 1.0).map(Response::new).map_err(err)
}

#[tauri::command]
pub fn reveal(path: String) {
    macos::reveal_in_finder(&path);
}

#[tauri::command]
pub fn open_path(path: String) {
    let p = crate::paths::expand_tilde(&path);
    let _ = std::fs::create_dir_all(if p.extension().is_none() { p.clone() } else { std::path::PathBuf::new() });
    macos::open_path(&p.to_string_lossy());
}

#[tauri::command]
pub fn open_url(url: String) {
    macos::open_url(&url);
}

#[tauri::command]
pub fn share_files(app: AppHandle, window: WebviewWindow, paths: Vec<String>, x: f64, y: f64) {
    macos::share_files(&app, &window, paths, x, y);
}

#[tauri::command]
pub fn print_image(app: AppHandle, path: String) {
    std::thread::spawn(move || macos::print_image(&app, path));
}

#[tauri::command]
pub fn emoji_palette(app: AppHandle) {
    macos::emoji_palette(&app);
}

#[tauri::command]
pub fn accent_color(app: AppHandle) -> String {
    macos::accent_color_hex(&app)
}

#[tauri::command]
pub fn ocr_languages() -> Vec<String> {
    crate::ocr::supported_languages()
}

#[tauri::command]
pub fn ocr_image_bytes(request: Request) -> CmdResult<crate::ocr::OcrResult> {
    let InvokeBody::Raw(bytes) = request.body() else { return Err("expected raw body".into()) };
    let img = crate::nativeimage::decode_bytes(bytes).ok_or("decode failed")?;
    Ok(crate::ocr::recognize(&img, &settings().ocr_language))
}

/// Path to a PNG of the current desktop wallpaper (for the Background Tool).
#[tauri::command]
pub fn wallpaper_path(app: AppHandle, blurred: bool) -> Option<String> {
    let d = crate::displays::under_mouse();
    let img = crate::desktop::wallpaper_image(&app, &d)?;
    let img = crate::imageops::thumbnail(&img, 2400);
    let img = if blurred { image::imageops::blur(&image::imageops::thumbnail(&img, 600, 400), 18.0) } else { img };
    let p = crate::paths::temp_dir().join(if blurred { "wallpaper-blur.jpg" } else { "wallpaper.jpg" });
    let bytes = crate::imageops::encode_jpeg(&img, 90).ok()?;
    std::fs::write(&p, bytes).ok()?;
    Some(p.to_string_lossy().to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Permissions {
    screen: bool,
    accessibility: bool,
}

#[tauri::command]
pub fn permissions_status() -> Permissions {
    Permissions { screen: macos::has_screen_permission(), accessibility: macos::has_accessibility_permission(false) }
}

#[tauri::command]
pub fn request_permission(app: AppHandle, kind: String) {
    match kind.as_str() {
        "screen" => crate::permissions::prompt_screen_recording(&app),
        "accessibility" => {
            macos::has_accessibility_permission(true);
        }
        "camera" | "microphone" => macos::open_privacy_settings(if kind == "camera" { "Privacy_Camera" } else { "Privacy_Microphone" }),
        _ => {}
    }
}

#[tauri::command]
pub fn app_version(app: AppHandle) -> String {
    app.package_info().version.to_string()
}

#[tauri::command]
pub fn quit(app: AppHandle) {
    app.exit(0);
}

#[tauri::command]
pub fn reset_warnings() {
    state::update_settings(|s| s.dismissed_warnings.clear());
}

#[tauri::command]
pub fn annotate_open(app: AppHandle, path: String) {
    crate::annotate::open(&app, &path, None);
}

/// Start a capture whose result is delivered back into an Annotate window.
#[tauri::command]
pub fn annotate_capture_into(app: AppHandle, window: WebviewWindow) {
    let label = window.label().to_string();
    let _ = window.hide();
    capture::start(&app, capture::Mode::Area, capture::StartOpts { deliver_to: Some(label), ..Default::default() });
}

#[tauri::command]
pub fn renderer_done(app: AppHandle, request: Request) {
    let id = request.headers().get("item").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    let bytes = match request.body() {
        InvokeBody::Raw(b) if !b.is_empty() => Some(b.clone()),
        _ => None,
    };
    crate::annotate::renderer_done(&app, &id, bytes);
}

/// Annotate finished an export that should go through the normal capture
/// pipeline pieces (Quick Access / pin).
#[tauri::command]
pub fn add_to_quick_access(app: AppHandle, path: String) {
    add_file_to_quick_access(&app, &path);
}

#[tauri::command]
pub fn after_capture_config(kind: String) -> crate::settings::AfterCapture {
    let s = settings();
    if kind == "video" { s.after_recording } else { s.after_screenshot }
}

#[tauri::command]
pub fn js_log(window: WebviewWindow, level: String, msg: String) {
    match level.as_str() {
        "error" => log::error!("[js:{}] {msg}", window.label()),
        "warn" => log::warn!("[js:{}] {msg}", window.label()),
        _ => log::info!("[js:{}] {msg}", window.label()),
    }
}

// ---------------- recording ----------------

#[tauri::command]
pub fn media_devices() -> crate::recording::Devices {
    crate::recording::devices()
}

#[tauri::command]
pub fn rec_info() -> Option<crate::recording::RecInfo> {
    crate::recording::info()
}

#[tauri::command]
pub fn rec_control(app: AppHandle, action: String) {
    match action.as_str() {
        "stop" => crate::recording::stop(&app),
        "pause" => crate::recording::toggle_pause(&app),
        "restart" => crate::recording::restart(&app),
        "discard" => crate::recording::discard(&app),
        _ => {}
    }
}

#[tauri::command]
pub fn camera_fullscreen(app: AppHandle, on: bool) {
    crate::recording::camera_fullscreen(&app, on);
}

#[tauri::command]
pub fn camera_save_position(x: f64, y: f64) {
    state::update_settings(|s| s.rec_camera_pos = Some((x, y)));
}

#[tauri::command]
pub fn camera_preview(app: AppHandle, on: bool) {
    crate::recording::preview_camera(&app, on);
}

// ---------------- video editor ----------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoInfo {
    duration: f64,
    width: u32,
    height: u32,
    size: u64,
}

#[tauri::command]
pub fn video_info(path: String) -> CmdResult<VideoInfo> {
    let p = Path::new(&path);
    Ok(VideoInfo {
        duration: crate::video::duration(p).ok_or("invalid video")?,
        width: crate::video::dimensions(p).map(|d| d.0).unwrap_or(0),
        height: crate::video::dimensions(p).map(|d| d.1).unwrap_or(0),
        size: std::fs::metadata(p).map(|m| m.len()).unwrap_or(0),
    })
}

#[tauri::command]
pub async fn video_filmstrip(path: String, count: usize) -> Vec<String> {
    tauri::async_runtime::spawn_blocking(move || crate::video::filmstrip(Path::new(&path), count, 80.0)).await.unwrap_or_default()
}

#[tauri::command]
pub fn video_export(app: AppHandle, window: WebviewWindow, path: String, opts: crate::video::ExportOpts) {
    crate::video::export_async(&app, window.label().to_string(), path, opts);
}

#[tauri::command]
pub fn video_open_editor(app: AppHandle, path: String) {
    crate::video::open_editor(&app, &path);
}

// ---------------- scrolling capture ----------------

#[tauri::command]
pub fn scroll_control(app: AppHandle, action: String) {
    match action.as_str() {
        "finish" => crate::scrolling::finish(&app),
        "cancel" => crate::scrolling::cancel(&app),
        "autoscrollOn" => crate::scrolling::set_autoscroll(true),
        "autoscrollOff" => crate::scrolling::set_autoscroll(false),
        _ => {}
    }
}

#[tauri::command]
pub fn scroll_preview() -> Option<(String, u32, u32, i64)> {
    crate::scrolling::last_preview()
}

/// Where Annotate's Save writes the edited image and its project:
/// `(image, project)`, see `quick_access::edit_paths`.
#[tauri::command]
pub fn annotate_edit_paths(capture_id: Option<String>, stem: String) -> (PathBuf, PathBuf) {
    crate::quick_access::edit_paths(capture_id.as_deref(), &stem)
}

/// Annotate's Save wrote both files: show the edit in Quick Access.
/// Returns the card's id.
#[tauri::command]
pub fn annotate_keep(app: AppHandle, capture_id: Option<String>, path: String, project: String) -> Option<String> {
    crate::quick_access::keep_edit(&app, capture_id.as_deref(), &path, Some(project))
}

/// Native screen color picker (eyedropper). Returns #RRGGBB or None.
#[tauri::command]
pub async fn pick_color(app: AppHandle) -> Option<String> {
    let (tx, rx) = std::sync::mpsc::channel::<Option<String>>();
    macos::on_main(&app, move |_| {
        let sampler = objc2_app_kit::NSColorSampler::new();
        let block = block2::RcBlock::new(move |color: *mut objc2_app_kit::NSColor| {
            let hex = if color.is_null() {
                None
            } else {
                let c = unsafe { &*color };
                c.colorUsingColorSpace(&objc2_app_kit::NSColorSpace::sRGBColorSpace()).map(|c| {
                    let to = |v: f64| (v.clamp(0.0, 1.0) * 255.0).round() as u8;
                    format!("#{:02X}{:02X}{:02X}", to(c.redComponent()), to(c.greenComponent()), to(c.blueComponent()))
                })
            };
            let _ = tx.send(hex);
        });
        // the sampler keeps itself alive until the session completes
        unsafe { sampler.showSamplerWithSelectionHandler(&block) };
    });
    tauri::async_runtime::spawn_blocking(move || rx.recv_timeout(std::time::Duration::from_secs(120)).ok().flatten())
        .await
        .ok()
        .flatten()
}

/// Small drag image for dragging captures out of our windows (the drag
/// plugin draws the icon at its natural size).
#[tauri::command]
pub fn drag_icon(path: String) -> String {
    let src = Path::new(&path);
    let out = crate::paths::temp_dir().join(format!(
        "drag-{}.png",
        src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default().replace(' ', "_")
    ));
    if out.exists() {
        return out.to_string_lossy().to_string();
    }
    match crate::imageops::load(src) {
        Ok(img) => {
            let t = crate::imageops::thumbnail(&img, 160);
            if let Ok(b) = crate::imageops::encode_png(&t, 1.0) {
                let _ = std::fs::write(&out, b);
                return out.to_string_lossy().to_string();
            }
            path
        }
        Err(_) => path,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageInfo {
    pub current: String,
    pub default: String,
}

#[tauri::command]
pub fn storage_info() -> StorageInfo {
    StorageInfo {
        current: crate::paths::data_dir().to_string_lossy().to_string(),
        default: crate::paths::config_dir().to_string_lossy().to_string(),
    }
}

/// Move captures & Capture History to `path` ("" = back to the default).
#[tauri::command]
pub async fn set_storage_location(app: AppHandle, path: String) -> CmdResult<StorageInfo> {
    tauri::async_runtime::spawn_blocking(move || crate::storage::set_location(&app, &path))
        .await
        .map_err(err)?
        .map_err(|e| format!("{e:#}"))?;
    Ok(storage_info())
}

#[tauri::command]
pub fn open_logs() {
    macos::open_path(&crate::paths::logs_dir().to_string_lossy());
}

#[tauri::command]
pub async fn ocr_ollama_status() -> crate::ocr_ollama::Status {
    let s = settings();
    tauri::async_runtime::spawn_blocking(move || crate::ocr_ollama::status(&s.ocr_ollama_url, &s.ocr_ollama_model))
        .await
        .unwrap_or(crate::ocr_ollama::Status { running: false, installed: false, error: Some("internal error".into()) })
}

/// Download the configured OCR model with Ollama.
#[tauri::command]
pub async fn ocr_ollama_pull() -> CmdResult<()> {
    let s = settings();
    tauri::async_runtime::spawn_blocking(move || crate::ocr_ollama::pull(&s.ocr_ollama_url, &s.ocr_ollama_model))
        .await
        .map_err(err)?
        .map_err(|e| format!("{e:#}"))
}
