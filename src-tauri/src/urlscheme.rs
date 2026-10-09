//! `screenshotx://` URL scheme API (mirrors CleanShot's documented API).
//!
//! screenshotx://all-in-one?x=&y=&width=&height=&display=
//! screenshotx://capture-area?x=&y=&width=&height=&display=&action=
//! screenshotx://capture-previous-area?action=
//! screenshotx://capture-fullscreen?action=&display=
//! screenshotx://capture-window?action=
//! screenshotx://self-timer?action=
//! screenshotx://scrolling-capture?x=&y=&width=&height=&display=&start=&autoscroll=
//! screenshotx://pin?filepath=
//! screenshotx://record-screen?x=&y=&width=&height=&display=
//! screenshotx://capture-text?filepath=&x=&y=&width=&height=&display=&linebreaks=
//! screenshotx://open-annotate?filepath=
//! screenshotx://open-from-clipboard
//! screenshotx://toggle-desktop-icons | hide-desktop-icons | show-desktop-icons
//! screenshotx://add-quick-access-overlay?filepath=
//! screenshotx://open-history | restore-recently-closed
//! screenshotx://open-settings?tab=

use crate::actions;
use crate::capture::{self, Mode, StartOpts};
use crate::state::{self, settings};
use std::collections::HashMap;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons};

pub fn handle(app: &AppHandle, raw: &str) {
    // never handle inline: deep links arrive inside Tauri's event dispatch
    let app = app.clone();
    let raw = raw.to_string();
    std::thread::spawn(move || handle_inner(&app, &raw));
}

fn handle_inner(app: &AppHandle, raw: &str) {
    log::info!("url: {raw}");
    let Ok(url) = url::Url::parse(raw) else { return };
    if url.scheme() != "screenshotx" {
        return;
    }
    match settings().allow_url_scheme {
        Some(true) => dispatch(app, &url),
        Some(false) => log::warn!("URL scheme disabled, ignoring {raw}"),
        None => {
            let app2 = app.clone();
            let url2 = url.clone();
            crate::macos::activate_app(app);
            app.dialog()
                .message("An external application wants to control Screenshot X.\n\nDo you want to allow applications to control Screenshot X through the URL scheme? You can change this later in Settings → Advanced.")
                .title("Allow applications to control Screenshot X?")
                .buttons(MessageDialogButtons::OkCancelCustom("Allow".into(), "Don't Allow".into()))
                .show(move |ok| {
                    state::update_settings(|s| s.allow_url_scheme = Some(ok));
                    if ok {
                        dispatch(&app2, &url2);
                    }
                });
        }
    }
}

fn dispatch(app: &AppHandle, url: &url::Url) {
    // screenshotx://capture-area → host = "capture-area"
    let cmd = url.host_str().map(String::from).unwrap_or_else(|| url.path().trim_matches('/').to_string());
    let q: HashMap<String, String> = url.query_pairs().map(|(k, v)| (k.to_string(), v.to_string())).collect();
    let f = |k: &str| q.get(k).and_then(|v| v.parse::<f64>().ok());
    let b = |k: &str| q.get(k).map(|v| v == "true" || v == "1");
    let display = q.get("display").and_then(|v| v.parse::<usize>().ok());
    let action = q.get("action").cloned();
    let rect = match (f("x"), f("y"), f("width"), f("height")) {
        (Some(x), Some(y), Some(w), Some(h)) if w > 0.0 && h > 0.0 => Some(capture::area_from_scheme(x, y, w, h, display)),
        _ => None,
    };
    let filepath = q.get("filepath").map(|p| crate::paths::expand_tilde(p).to_string_lossy().to_string());
    let opts = StartOpts { action: action.clone(), rect: rect.clone(), display, ..Default::default() };
    match cmd.as_str() {
        "all-in-one" => capture::start(app, Mode::AllInOne, opts),
        "capture-area" => match rect {
            Some(r) => capture::capture_rect(app, r, opts),
            None => capture::start(app, Mode::Area, opts),
        },
        "capture-previous-area" => capture::capture_previous_area(app, opts),
        "capture-fullscreen" => capture::capture_fullscreen(app, opts),
        "capture-window" => capture::start(app, Mode::Window, opts),
        "self-timer" => capture::start(app, Mode::SelfTimer, opts),
        "scrolling-capture" if state::state().scrolling.lock().is_some() => crate::scrolling::finish(app),
        "scrolling-capture" => capture::start(
            app,
            Mode::Scrolling,
            StartOpts { scrolling_start: b("start").unwrap_or(false), autoscroll: b("autoscroll").unwrap_or(false), ..opts },
        ),
        "pin" => match filepath {
            Some(p) => crate::pins::open(app, &p),
            None => actions::run(app, "pinImage"),
        },
        "record-screen" => {
            if state::state().recording.lock().is_some() {
                crate::recording::stop(app);
            } else {
                capture::start(app, Mode::Record, opts)
            }
        }
        "capture-text" => {
            let lb = b("linebreaks");
            match filepath {
                Some(p) => crate::ocr::run_on_file(app, &p, lb.unwrap_or(settings().ocr_keep_line_breaks)),
                None => capture::start(app, Mode::Ocr, StartOpts { ocr_linebreaks: lb, ..opts }),
            }
        }
        "open-annotate" => match filepath {
            Some(p) => crate::annotate::open(app, &p, None),
            None => actions::run(app, "openAnnotate"),
        },
        "open-from-clipboard" => actions::open_from_clipboard(app),
        "toggle-desktop-icons" => crate::desktop::toggle(app),
        "hide-desktop-icons" => crate::desktop::set_hidden(app, true),
        "show-desktop-icons" => crate::desktop::set_hidden(app, false),
        "add-quick-access-overlay" => {
            if let Some(p) = filepath {
                crate::commands::add_file_to_quick_access(app, &p);
            }
        }
        "open-history" => crate::commands::open_history(app),
        "restore-recently-closed" => crate::quick_access::restore(app),
        "open-settings" => crate::commands::open_settings(app, q.get("tab").cloned()),
        // Debug builds only: capture the display under the mouse *including*
        // our own windows, to inspect the UI during development.
        "debug-snap" if cfg!(debug_assertions) => {
            let out = q.get("path").cloned().unwrap_or_else(|| "/tmp/sx-debug.png".into());
            std::thread::spawn(move || {
                let d = display.and_then(crate::displays::by_index).unwrap_or_else(crate::displays::under_mouse);
                if let Ok(content) = crate::sck::shareable_content() {
                    if let Ok(img) = crate::sck::capture_display(&content, &d, &[], None, true, Some(1.0)) {
                        if let Ok(b) = crate::imageops::encode_png(&img, 1.0) {
                            let _ = std::fs::write(out, b);
                        }
                    }
                }
            });
        }
        // Debug builds only: record a region for N seconds without UI clicks.
        "debug-record" if cfg!(debug_assertions) => {
            let secs = q.get("secs").and_then(|v| v.parse::<u64>().ok()).unwrap_or(3);
            let kind = q.get("kind").cloned().unwrap_or_else(|| "video".into());
            let sysaudio = b("sysaudio").unwrap_or(false);
            let prev = settings().rec_record_computer_audio;
            if sysaudio {
                state::update_settings(|s| s.rec_record_computer_audio = true);
            }
            let app = app.clone();
            std::thread::spawn(move || {
                let d = crate::displays::under_mouse();
                let r = crate::capture::Rect { x: 100.0, y: 100.0, w: 640.0, h: 400.0 };
                if let Err(e) = crate::recording::begin(&app, d, r, kind, None, serde_json::Value::Null, false) {
                    log::error!("debug-record: {e:#}");
                    return;
                }
                std::thread::sleep(std::time::Duration::from_secs(secs));
                crate::recording::stop(&app);
                if sysaudio {
                    state::update_settings(|s| s.rec_record_computer_audio = prev);
                }
            });
        }
        "close-all-overlays" => crate::quick_access::close_all(app),
        // Debug builds only: log key-window state of our windows.
        "debug-keystate" if cfg!(debug_assertions) => {
            let wins: Vec<(String, tauri::WebviewWindow)> = app.webview_windows().into_iter().collect();
            crate::macos::on_main(app, move |mtm| {
                let ns_app = objc2_app_kit::NSApplication::sharedApplication(mtm);
                log::info!("keystate: app active={}", ns_app.isActive());
                for (label, w) in wins {
                    if let Some(nsw) = crate::macos::ns_window(&w) {
                        if nsw.isVisible() {
                            log::info!(
                                "keystate: {label} class={} key={} mask={:?} canKey={}",
                                nsw.class().name().to_string_lossy(),
                                nsw.isKeyWindow(),
                                nsw.styleMask().0,
                                nsw.canBecomeKeyWindow()
                            );
                        }
                    }
                }
            });
        }
        // Debug builds only: run a Quick Access action on the newest card.
        "debug-qa" if cfg!(debug_assertions) => {
            let id = state::state().qa_items.lock().last().map(|i| i.id.clone());
            if let Some(id) = id {
                let r = crate::quick_access::action(app, &id, q.get("action").map(|s| s.as_str()).unwrap_or("copy"), q.get("arg").cloned());
                log::info!("debug-qa: {r:?}");
            }
        }
        // Debug builds only: capture our own Settings window (window
        // capture pipeline test that never touches other apps' content).
        "debug-window" if cfg!(debug_assertions) => {
            let out = q.get("path").cloned().unwrap_or_else(|| "/tmp/sx-window.png".into());
            let d = crate::displays::list()[0].clone();
            if let Some(w) = app.get_webview_window("prefs") {
                if let Some(id) = crate::macos::window_number(&w) {
                    match crate::capture::capture_window_styled(app, id, !b("noshadow").unwrap_or(false), &d) {
                        Ok(img) => {
                            let _ = std::fs::write(&out, crate::imageops::encode_png(&img, d.scale).unwrap_or_default());
                        }
                        Err(e) => log::error!("debug-window: {e:#}"),
                    }
                }
            }
        }
        // Debug builds only: export a video with the editor pipeline.
        "debug-export" if cfg!(debug_assertions) => {
            if let Some(p) = filepath.clone() {
                let opts = crate::video::ExportOpts {
                    start: f("start").unwrap_or(0.0),
                    end: f("end").unwrap_or(1e9),
                    quality: q.get("quality").cloned().unwrap_or_else(|| "high".into()),
                    resolution: f("resolution").unwrap_or(0.0) as u32,
                    audio: q.get("audio").cloned().unwrap_or_else(|| "keep".into()),
                    volume: 1.0,
                    format: q.get("format").cloned().unwrap_or_else(|| "mp4".into()),
                    gif_fps: 10,
                    gif_width: 480,
                    gif_quality: 70,
                    save_mode: "new".into(),
                };
                let opts = crate::video::ExportOpts { end: opts.end.min(crate::video::duration(std::path::Path::new(&p)).unwrap_or(1.0)), ..opts };
                match crate::video::export(std::path::Path::new(&p), &opts, |_| {}) {
                    Ok(o) => log::info!("debug-export ok: {}", o.display()),
                    Err(e) => log::error!("debug-export failed: {e:#}"),
                }
            }
        }
        // Debug builds only: close every editor / pin window opened by tests.
        "debug-close-windows" if cfg!(debug_assertions) => {
            let labels: Vec<String> = app.webview_windows().keys().filter(|l| l.starts_with("annotate-") || l.starts_with("pin-") || l.starts_with("video-") || *l == "prefs" || *l == "history").cloned().collect();
            for l in labels {
                if l.starts_with("pin-") {
                    crate::pins::close(app, &l);
                } else {
                    crate::windows::close(app, &l);
                }
            }
        }
        other => log::warn!("unknown url command {other}"),
    }
}
