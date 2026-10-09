//! Capture sessions: snapshot displays, show selection overlays, and turn
//! the user's selection into a screenshot / recording / OCR / scroll capture.

use crate::displays::{self, Display};
use crate::macos;
use crate::sck::{self, WinInfo};
use crate::settings::{SavedArea, WindowBackground};
use crate::state::{self, settings};
use crate::windows::{self, PanelKind, Spec};
use anyhow::{anyhow, Result};
use image::RgbaImage;
use once_cell::sync::OnceCell;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static SESSION_IDS: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub enum Mode {
    Area,
    Window,
    AllInOne,
    Scrolling,
    Record,
    Ocr,
    SelfTimer,
}

pub struct Snapshot {
    pub display: Display,
    pub image: Arc<RgbaImage>,
    pub bmp: OnceCell<Arc<Vec<u8>>>,
}

pub struct Session {
    pub id: u64,
    pub mode: Mode,
    pub opts: StartOpts,
    pub snaps: Vec<Snapshot>,
    pub windows: Vec<WinInfo>,
    pub front: Option<macos::FrontApp>,
    pub window_title: String,
    pub hid_icons: bool,
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", default)]
pub struct StartOpts {
    /// override for the after-capture actions: copy|save|annotate|upload|pin
    pub action: Option<String>,
    /// preset selection (display-local points, top-left origin)
    pub rect: Option<SavedArea>,
    pub record_kind: Option<String>,
    pub ocr_linebreaks: Option<bool>,
    pub scrolling_start: bool,
    pub autoscroll: bool,
    /// target display for fullscreen captures (1-based index)
    pub display: Option<usize>,
    /// "Add New Screenshot" from Annotate: deliver into that window
    pub deliver_to: Option<String>,
}

pub fn overlay_label(display_id: u32) -> String {
    format!("overlay-{display_id}")
}

/// Pre-create one hidden overlay per display so showing it is instant.
pub fn prewarm_overlays(app: &AppHandle) {
    for d in displays::list() {
        let _ = ensure_overlay(app, &d);
    }
}

fn ensure_overlay(app: &AppHandle, d: &Display) -> Result<tauri::WebviewWindow> {
    let label = overlay_label(d.id);
    if let Some(w) = app.get_webview_window(&label) {
        macos::set_frame_cg(app, &w, d.x, d.y, d.width, d.height);
        return Ok(w);
    }
    let mut spec = Spec::new(&label, "overlay");
    spec.query = vec![("display", d.id.to_string())];
    spec.width = d.width;
    spec.height = d.height;
    spec.pos = Some((d.x, d.y));
    spec.panel = Some(PanelKind::Key);
    spec.level = macos::Level::Overlay;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    spec.visible = false;
    Ok(windows::create(app, spec)?)
}

pub fn is_active() -> bool {
    state::state().session.lock().is_some()
}

/// Begin an interactive capture.
pub fn start(app: &AppHandle, mode: Mode, opts: StartOpts) {
    if state::state().recording.lock().is_some() && mode == Mode::Record {
        crate::recording::stop(app);
        return;
    }
    if is_active() {
        cancel(app);
        return;
    }
    if !macos::has_screen_permission() {
        crate::permissions::prompt_screen_recording(app);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        if let Err(e) = start_inner(&app, mode, opts) {
            log::error!("capture start failed: {e:#}");
            crate::toast::show(&app, "error", "Capture failed", &format!("{e}"));
            *state::state().session.lock() = None;
            crate::hotkeys::end_session_keys(&app, "overlay");
        }
    });
}

fn start_inner(app: &AppHandle, mode: Mode, opts: StartOpts) -> Result<()> {
    log::info!("capture start {mode:?}");
    let s = settings();
    let front = macos::frontmost_app();
    let hid_icons = s.hide_desktop_icons_while_capturing && !state::state().desktop_icons_hidden.load(Ordering::SeqCst);
    if hid_icons {
        crate::desktop::set_hidden(app, true);
        std::thread::sleep(Duration::from_millis(60));
    }
    let all_windows = sck::window_list();
    let window_title = front
        .as_ref()
        .and_then(|f| all_windows.iter().find(|w| w.pid == f.pid && w.layer == 0))
        .map(|w| w.title.clone())
        .unwrap_or_default();
    let pickable = sck::pickable_windows();

    let content = sck::shareable_content()?;
    let exclude = windows::excluded_window_numbers(app, s.pins_show_on_screenshots);
    let disps = displays::list();
    let snaps: Vec<Snapshot> = std::thread::scope(|scope| {
        let handles: Vec<_> = disps
            .iter()
            .map(|d| {
                let content = &content;
                let exclude = &exclude;
                scope.spawn(move || {
                    sck::capture_display(content, d, exclude, None, false, None)
                        .map(|img| Snapshot { display: d.clone(), image: Arc::new(img), bmp: OnceCell::new() })
                })
            })
            .collect();
        handles.into_iter().filter_map(|h| h.join().ok().and_then(|r| r.ok())).collect()
    });
    if snaps.is_empty() {
        return Err(anyhow!("Could not capture the screen. Check the Screen Recording permission."));
    }

    let id = SESSION_IDS.fetch_add(1, Ordering::SeqCst);
    *state::state().session.lock() = Some(Session {
        id,
        mode,
        opts,
        snaps,
        windows: pickable,
        front,
        window_title,
        hid_icons,
    });

    crate::hotkeys::session_keys(app, "overlay", crate::hotkeys::OVERLAY_KEYS);
    // Each overlay renders its fresh state, then calls `overlay_ready`,
    // which orders it front (avoids flashing the previous session).
    for d in &disps {
        let w = ensure_overlay(app, d)?;
        let _ = w.emit_to(w.label(), "overlay:start", id);
    }
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlayPayload {
    pub session_id: u64,
    pub mode: Mode,
    pub display: Display,
    pub image_url: String,
    pub windows: Vec<WinInfo>,
    pub mouse: Option<(f64, f64)>,
    pub crosshair: String,
    pub magnifier: bool,
    pub freeze: bool,
    pub preset: Option<SavedArea>,
    pub remember: Option<SavedArea>,
    pub record_kind: String,
    pub settings: serde_json::Value,
    pub accent: String,
}

pub fn payload(app: &AppHandle, display_id: u32) -> Option<OverlayPayload> {
    let st = state::state();
    let guard = st.session.lock();
    let sess = guard.as_ref()?;
    let snap = sess.snaps.iter().find(|s| s.display.id == display_id)?;
    let d = &snap.display;
    let s = settings();
    let (mx, my) = macos::mouse_location();
    let mouse = if d.contains(mx, my) { Some((mx - d.x, my - d.y)) } else { None };
    let windows: Vec<WinInfo> = sess
        .windows
        .iter()
        .filter(|w| w.x < d.x + d.width && w.x + w.width > d.x && w.y < d.y + d.height && w.y + w.height > d.y)
        .map(|w| WinInfo { x: w.x - d.x, y: w.y - d.y, ..w.clone() })
        .collect();
    let remember = match sess.mode {
        Mode::AllInOne if s.remember_last_selection => s.last_aio_area.clone(),
        Mode::Record if s.rec_remember_last_selection => s.last_record_area.clone(),
        _ => None,
    }
    .filter(|a| a.display_id == display_id);
    let preset = sess.opts.rect.clone().filter(|a| a.display_id == display_id);
    Some(OverlayPayload {
        session_id: sess.id,
        mode: sess.mode,
        display: d.clone(),
        image_url: format!("sx://localhost/snapshot/{}/{}", sess.id, d.id),
        windows,
        mouse,
        crosshair: serde_json::to_value(&s.crosshair_mode).ok().and_then(|v| v.as_str().map(String::from)).unwrap_or_default(),
        magnifier: s.show_magnifier,
        freeze: s.freeze_screen,
        preset,
        remember,
        record_kind: sess.opts.record_kind.clone().unwrap_or(s.rec_last_type.clone()),
        settings: serde_json::json!({
            "recShowCursor": s.rec_show_cursor,
            "recHighlightClicks": s.rec_highlight_clicks,
            "recShowKeystrokes": s.rec_show_keystrokes,
            "recRecordMicrophone": s.rec_record_microphone,
            "recRecordComputerAudio": s.rec_record_computer_audio,
            "recRecordCamera": s.rec_record_camera,
            "recDoNotDisturb": s.rec_do_not_disturb,
            "recDimScreen": s.rec_dim_screen,
            "recMicrophone": s.rec_microphone,
            "recCamera": s.rec_camera,
            "recVideoFps": s.rec_video_fps,
            "windowShadow": s.capture_window_shadow,
            "selfTimerSeconds": s.self_timer_seconds,
            "autoscroll": sess.opts.autoscroll,
            "scrollingStart": sess.opts.scrolling_start,
        }),
        accent: macos::accent_color_hex(app),
    })
}

/// BMP bytes of a session snapshot (served to the overlay through `sx://`).
pub fn snapshot_bmp(session_id: u64, display_id: u32) -> Option<Arc<Vec<u8>>> {
    let st = state::state();
    let guard = st.session.lock();
    let sess = guard.as_ref().filter(|s| s.id == session_id)?;
    let snap = sess.snaps.iter().find(|s| s.display.id == display_id)?;
    Some(snap.bmp.get_or_init(|| Arc::new(crate::imageops::encode_bmp(&snap.image))).clone())
}

fn hide_overlays(app: &AppHandle) {
    crate::hotkeys::end_session_keys(app, "overlay");
    for d in displays::list() {
        let label = overlay_label(d.id);
        if let Some(w) = app.get_webview_window(&label) {
            let _ = w.emit_to(w.label(), "overlay:end", ());
        }
        windows::hide(app, &label);
    }
}

pub fn cancel(app: &AppHandle) {
    hide_overlays(app);
    let sess = state::state().session.lock().take();
    if let Some(sess) = sess {
        if sess.hid_icons {
            crate::desktop::set_hidden(app, false);
        }
        // "Add New Screenshot" from Annotate: bring the editor back
        if let Some(label) = sess.opts.deliver_to {
            windows::make_key(app, &label);
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub session_id: u64,
    pub display_id: u32,
    /// area | window | fullscreen | record | scroll | ocr | selftimer
    pub kind: String,
    pub rect: Option<Rect>,
    pub window_id: Option<u32>,
    #[serde(default)]
    pub no_shadow: bool,
    pub record_kind: Option<String>,
    #[serde(default)]
    pub autoscroll: bool,
    pub action: Option<String>,
    #[serde(default)]
    pub record_options: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

pub struct Context {
    pub app_name: String,
    pub window_title: String,
    pub action: Option<String>,
    pub deliver_to: Option<String>,
}

pub fn commit(app: &AppHandle, c: Commit) {
    let sess = {
        let st = state::state();
        let mut g = st.session.lock();
        match g.as_ref() {
            Some(s) if s.id == c.session_id => g.take(),
            _ => None,
        }
    };
    let Some(sess) = sess else { return };
    hide_overlays(app);
    let app = app.clone();
    std::thread::spawn(move || {
        let hid_icons = sess.hid_icons;
        let keep_icons_hidden = c.kind == "record" || c.kind == "scroll";
        if let Err(e) = commit_inner(&app, &sess, &c) {
            log::error!("commit failed: {e:#}");
            crate::toast::show(&app, "error", "Capture failed", &e.to_string());
        }
        if hid_icons && !keep_icons_hidden {
            crate::desktop::set_hidden(&app, false);
        }
    });
}

fn commit_inner(app: &AppHandle, sess: &Session, c: &Commit) -> Result<()> {
    let s = settings();
    let snap = sess.snaps.iter().find(|x| x.display.id == c.display_id).ok_or_else(|| anyhow!("no display"))?;
    let d = snap.display.clone();
    let ctx = Context {
        app_name: sess.front.as_ref().map(|f| f.name.clone()).unwrap_or_default(),
        window_title: sess.window_title.clone(),
        action: c.action.clone().or(sess.opts.action.clone()),
        deliver_to: sess.opts.deliver_to.clone(),
    };
    let rect = c.rect.map(|r| clamp_rect(r, &d));
    if let Some(r) = rect {
        let area = SavedArea { display_id: d.id, x: r.x, y: r.y, w: r.w, h: r.h };
        state::update_settings(|st| {
            match sess.mode {
                Mode::AllInOne => st.last_aio_area = Some(area.clone()),
                Mode::Record => st.last_record_area = Some(area.clone()),
                _ => {}
            }
            if c.kind == "area" || c.kind == "selftimer" {
                st.last_area = Some(area);
            }
        });
    }
    match c.kind.as_str() {
        "area" => {
            let r = rect.ok_or_else(|| anyhow!("no rect"))?;
            let img = if s.freeze_screen {
                crop_snapshot(snap, r)
            } else {
                std::thread::sleep(Duration::from_millis(25));
                fresh_region(app, &d, r, s.capture_cursor)?
            };
            crate::output::finish_screenshot(app, img, d.scale, ctx);
        }
        "fullscreen" => {
            let img = if s.freeze_screen {
                (*snap.image).clone()
            } else {
                std::thread::sleep(Duration::from_millis(25));
                fresh_region(app, &d, Rect { x: 0.0, y: 0.0, w: d.width, h: d.height }, s.capture_cursor)?
            };
            crate::output::finish_screenshot(app, img, d.scale, ctx);
        }
        "selftimer" => {
            let r = rect.unwrap_or(Rect { x: 0.0, y: 0.0, w: d.width, h: d.height });
            countdown(app, &d, Some(r), s.self_timer_seconds);
            let img = fresh_region(app, &d, r, s.capture_cursor)?;
            crate::output::finish_screenshot(app, img, d.scale, ctx);
        }
        "window" => {
            let wid = c.window_id.ok_or_else(|| anyhow!("no window"))?;
            let shadow = s.capture_window_shadow && !c.no_shadow;
            let img = capture_window_styled(app, wid, shadow, &d)?;
            let title = sess.windows.iter().find(|w| w.id == wid).map(|w| (w.owner.clone(), w.title.clone()));
            let ctx = Context {
                app_name: title.as_ref().map(|t| t.0.clone()).unwrap_or(ctx.app_name),
                window_title: title.map(|t| t.1).unwrap_or(ctx.window_title),
                ..ctx
            };
            crate::output::finish_screenshot(app, img, d.scale, ctx);
        }
        "ocr" => {
            let r = rect.ok_or_else(|| anyhow!("no rect"))?;
            let img = crop_snapshot(snap, r);
            let linebreaks = sess.opts.ocr_linebreaks.unwrap_or(s.ocr_keep_line_breaks);
            crate::ocr::run_and_copy(app, &img, linebreaks);
        }
        "record" => {
            let r = rect.unwrap_or(Rect { x: 0.0, y: 0.0, w: d.width, h: d.height });
            let kind = c.record_kind.clone().unwrap_or_else(|| s.rec_last_type.clone());
            state::update_settings(|st| st.rec_last_type = kind.clone());
            crate::recording::begin(app, d, r, kind, c.window_id, c.record_options.clone(), sess.hid_icons)?;
        }
        "scroll" => {
            let r = rect.ok_or_else(|| anyhow!("no rect"))?;
            crate::scrolling::begin(app, d, r, c.autoscroll || sess.opts.autoscroll, ctx, sess.hid_icons)?;
        }
        _ => {}
    }
    Ok(())
}

fn clamp_rect(r: Rect, d: &Display) -> Rect {
    let x = r.x.max(0.0).min(d.width - 1.0);
    let y = r.y.max(0.0).min(d.height - 1.0);
    let w = r.w.max(1.0).min(d.width - x);
    let h = r.h.max(1.0).min(d.height - y);
    Rect { x, y, w, h }
}

fn crop_snapshot(snap: &Snapshot, r: Rect) -> RgbaImage {
    let s = snap.image.width() as f64 / snap.display.width;
    crate::imageops::crop(
        &snap.image,
        (r.x * s).round() as u32,
        (r.y * s).round() as u32,
        (r.w * s).round() as u32,
        (r.h * s).round() as u32,
    )
}

/// Capture a region now, excluding our own UI.
pub fn fresh_region(app: &AppHandle, d: &Display, r: Rect, cursor: bool) -> Result<RgbaImage> {
    let content = sck::shareable_content()?;
    let s = settings();
    let exclude = windows::excluded_window_numbers(app, s.pins_show_on_screenshots);
    sck::capture_display(&content, d, &exclude, Some((r.x, r.y, r.w, r.h)), cursor, None)
}

/// Capture a window and apply the "Window screenshot" background style.
pub fn capture_window_styled(app: &AppHandle, wid: u32, shadow: bool, d: &Display) -> Result<RgbaImage> {
    let s = settings();
    let content = sck::shareable_content()?;
    let img = sck::capture_window(&content, wid, shadow, d.scale)?;
    let pad = (s.window_padding as f64 * d.scale) as u32;
    Ok(match s.window_background {
        WindowBackground::Transparent => img,
        WindowBackground::PlainColor => {
            crate::imageops::window_on_background(&img, None, crate::imageops::parse_hex(&s.window_bg_color), pad)
        }
        WindowBackground::Wallpaper => {
            let wp = crate::desktop::wallpaper_image(app, d);
            crate::imageops::window_on_background(&img, wp.as_ref(), [30, 30, 30, 255], pad)
        }
    })
}

/// Show a countdown over `rect` (or the display) and block until it ends.
pub fn countdown(app: &AppHandle, d: &Display, rect: Option<Rect>, seconds: u32) {
    if seconds == 0 {
        return;
    }
    let r = rect.unwrap_or(Rect { x: 0.0, y: 0.0, w: d.width, h: d.height });
    let size = 180.0;
    let x = d.x + r.x + r.w / 2.0 - size / 2.0;
    let y = d.y + r.y + r.h / 2.0 - size / 2.0;
    let label = "countdown";
    windows::close(app, label);
    let mut spec = Spec::new(label, "countdown");
    spec.query = vec![("seconds", seconds.to_string())];
    spec.width = size;
    spec.height = size;
    spec.pos = Some((x, y));
    spec.panel = Some(PanelKind::Passive);
    spec.level = macos::Level::Overlay;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    spec.click_through = true;
    let _ = windows::create(app, spec);
    for _ in 0..seconds {
        macos::play_sound(app, "countdown");
        std::thread::sleep(Duration::from_millis(1000));
    }
    windows::close(app, label);
    std::thread::sleep(Duration::from_millis(80));
}

// ---------- non-interactive captures ----------

pub fn capture_fullscreen(app: &AppHandle, opts: StartOpts) {
    if !macos::has_screen_permission() {
        crate::permissions::prompt_screen_recording(app);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let s = settings();
        let d = opts.display.and_then(displays::by_index).unwrap_or_else(displays::under_mouse);
        let front = macos::frontmost_app();
        let hid = s.hide_desktop_icons_while_capturing && !state::state().desktop_icons_hidden.load(Ordering::SeqCst);
        if hid {
            crate::desktop::set_hidden(&app, true);
            std::thread::sleep(Duration::from_millis(80));
        }
        let r = fresh_region(&app, &d, Rect { x: 0.0, y: 0.0, w: d.width, h: d.height }, s.capture_cursor);
        if hid {
            crate::desktop::set_hidden(&app, false);
        }
        match r {
            Ok(img) => crate::output::finish_screenshot(
                &app,
                img,
                d.scale,
                Context {
                    app_name: front.map(|f| f.name).unwrap_or_default(),
                    window_title: String::new(),
                    action: opts.action,
                    deliver_to: opts.deliver_to,
                },
            ),
            Err(e) => crate::toast::show(&app, "error", "Capture failed", &e.to_string()),
        }
    });
}

/// Capture a known rect without UI (previous area, URL scheme with x/y/w/h).
pub fn capture_rect(app: &AppHandle, area: SavedArea, opts: StartOpts) {
    if !macos::has_screen_permission() {
        crate::permissions::prompt_screen_recording(app);
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        let s = settings();
        let Some(d) = displays::by_id(area.display_id).or_else(|| Some(displays::under_mouse())) else { return };
        let front = macos::frontmost_app();
        let r = clamp_rect(Rect { x: area.x, y: area.y, w: area.w, h: area.h }, &d);
        match fresh_region(&app, &d, r, s.capture_cursor) {
            Ok(img) => crate::output::finish_screenshot(
                &app,
                img,
                d.scale,
                Context {
                    app_name: front.map(|f| f.name).unwrap_or_default(),
                    window_title: String::new(),
                    action: opts.action,
                    deliver_to: opts.deliver_to,
                },
            ),
            Err(e) => crate::toast::show(&app, "error", "Capture failed", &e.to_string()),
        }
    });
}

pub fn capture_previous_area(app: &AppHandle, opts: StartOpts) {
    match settings().last_area {
        Some(a) => capture_rect(app, a, opts),
        None => start(app, Mode::Area, opts),
    }
}

/// Convert URL-scheme coordinates (origin bottom-left of the display) into
/// a display-local top-left rect.
pub fn area_from_scheme(x: f64, y: f64, w: f64, h: f64, display: Option<usize>) -> SavedArea {
    let d = display.and_then(displays::by_index).unwrap_or_else(displays::under_mouse);
    SavedArea { display_id: d.id, x, y: d.height - y - h, w, h }
}

/// Called by an overlay once it rendered the current session.
pub fn overlay_ready(app: &AppHandle, display_id: u32, session_id: u64) {
    log::info!("overlay_ready display={display_id} session={session_id}");
    let ok = state::state().session.lock().as_ref().map(|s| s.id == session_id).unwrap_or(false);
    if !ok {
        return;
    }
    let label = overlay_label(display_id);
    if let Some(w) = app.get_webview_window(&label) {
        windows::show(app, &w, false);
        let (mx, my) = macos::mouse_location();
        if displays::at_point(mx, my).id == display_id {
            windows::make_key(app, &label);
        }
    }
}
