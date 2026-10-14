//! Every user-invokable command, shared by global shortcuts, the menu bar
//! menu and the URL scheme.

use crate::capture::{self, Mode, StartOpts};
use crate::state::{self, settings};
use serde::Serialize;
use tauri::AppHandle;
use tauri_plugin_dialog::DialogExt;

#[derive(Serialize, Clone)]
pub struct ActionDef {
    pub id: &'static str,
    pub label: &'static str,
    pub group: &'static str,
}

pub const ACTIONS: &[ActionDef] = &[
    ActionDef { id: "allInOne", label: "All-In-One", group: "Screenshots" },
    ActionDef { id: "captureArea", label: "Capture Area", group: "Screenshots" },
    ActionDef { id: "capturePreviousArea", label: "Capture Previous Area", group: "Screenshots" },
    ActionDef { id: "captureFullscreen", label: "Capture Fullscreen", group: "Screenshots" },
    ActionDef { id: "captureWindow", label: "Capture Window", group: "Screenshots" },
    ActionDef { id: "selfTimer", label: "Self-Timer", group: "Screenshots" },
    ActionDef { id: "scrollingCapture", label: "Scrolling Capture", group: "Screenshots" },
    ActionDef { id: "captureText", label: "Capture Text (OCR)", group: "Screenshots" },
    ActionDef { id: "captureTextNoBreaks", label: "Capture Text Without Line Breaks", group: "Screenshots" },
    ActionDef { id: "captureAreaCopy", label: "Capture Area & Copy to Clipboard", group: "Screenshots" },
    ActionDef { id: "captureAreaSave", label: "Capture Area & Save", group: "Screenshots" },
    ActionDef { id: "captureAreaAnnotate", label: "Capture Area & Annotate", group: "Screenshots" },
    ActionDef { id: "captureAreaPin", label: "Capture Area & Pin to the Screen", group: "Screenshots" },
    ActionDef { id: "recordScreen", label: "Record Screen / Stop Recording", group: "Screen Recording" },
    ActionDef { id: "recordGif", label: "Record GIF / Stop Recording", group: "Screen Recording" },
    ActionDef { id: "toggleCameraFullscreen", label: "Toggle Camera Fullscreen", group: "Screen Recording" },
    ActionDef { id: "openFromClipboard", label: "Open from Clipboard", group: "Annotate" },
    ActionDef { id: "openAnnotate", label: "Open Annotate Tool", group: "Annotate" },
    ActionDef { id: "annotateLast", label: "Annotate Last Screenshot", group: "Annotate" },
    ActionDef { id: "pinImage", label: "Pin to the Screen...", group: "Pins" },
    ActionDef { id: "pinLast", label: "Pin Last Screenshot", group: "Pins" },
    ActionDef { id: "togglePins", label: "Toggle Pins Visibility", group: "Pins" },
    ActionDef { id: "toggleDesktopIcons", label: "Toggle Desktop Icons", group: "Other" },
    ActionDef { id: "restoreLast", label: "Restore Last Capture", group: "Other" },
    ActionDef { id: "openHistory", label: "Open Capture History", group: "Other" },
    ActionDef { id: "closeAllOverlays", label: "Close All Overlays", group: "Other" },
    ActionDef { id: "hideOverlays", label: "Hide/Show Overlays", group: "Other" },
];

pub fn label(id: &str) -> &'static str {
    ACTIONS.iter().find(|a| a.id == id).map(|a| a.label).unwrap_or("")
}

/// Run an action off the calling thread: callbacks from menus, shortcuts and
/// deep links run inside Tauri's event dispatch, where creating windows
/// synchronously would deadlock.
pub fn run(app: &AppHandle, id: &str) {
    let app = app.clone();
    let id = id.to_string();
    std::thread::spawn(move || run_with(&app, &id, StartOpts::default()));
}

pub fn run_with(app: &AppHandle, id: &str, mut opts: StartOpts) {
    log::info!("action {id}");
    match id {
        "allInOne" => capture::start(app, Mode::AllInOne, opts),
        "captureArea" => capture::start(app, Mode::Area, opts),
        "capturePreviousArea" => capture::capture_previous_area(app, opts),
        "captureFullscreen" => capture::capture_fullscreen(app, opts),
        "captureWindow" => capture::start(app, Mode::Window, opts),
        "selfTimer" => capture::start(app, Mode::SelfTimer, opts),
        "scrollingCapture" => {
            if state::state().scrolling.lock().is_some() {
                crate::scrolling::finish(app);
            } else {
                capture::start(app, Mode::Scrolling, opts)
            }
        }
        "captureText" => capture::start(app, Mode::Ocr, opts),
        "captureTextNoBreaks" => {
            opts.ocr_linebreaks = Some(false);
            capture::start(app, Mode::Ocr, opts)
        }
        "captureAreaCopy" | "captureAreaSave" | "captureAreaAnnotate" | "captureAreaPin" => {
            opts.action = Some(
                match id {
                    "captureAreaCopy" => "copy",
                    "captureAreaSave" => "save",
                    "captureAreaAnnotate" => "annotate",
                    _ => "pin",
                }
                .into(),
            );
            capture::start(app, Mode::Area, opts)
        }
        "recordScreen" | "recordGif" => {
            if state::state().recording.lock().is_some() {
                crate::recording::stop(app);
            } else {
                opts.record_kind = Some(if id == "recordGif" { "gif".into() } else { "video".into() });
                capture::start(app, Mode::Record, opts)
            }
        }
        "toggleCameraFullscreen" => crate::recording::toggle_camera_fullscreen(app),
        "openFromClipboard" => open_from_clipboard(app),
        "openAnnotate" => choose_file(app, "Open Annotation Tool", |app, p| crate::annotate::open(app, &p, None)),
        "annotateLast" => match state::state().last_capture.lock().clone().or_else(crate::history::latest) {
            Some(c) if matches!(c.kind, state::CaptureKind::Screenshot) => crate::annotate::open(app, &c.path, Some(c.id)),
            _ => crate::toast::show(app, "info", "No recent screenshot", ""),
        },
        "pinImage" => choose_file(app, "Choose and Pin an Image", |app, p| crate::pins::open(app, &p)),
        "pinLast" => match state::state().last_capture.lock().clone().or_else(crate::history::latest) {
            Some(c) if matches!(c.kind, state::CaptureKind::Screenshot) => crate::pins::open(app, &c.path),
            _ => crate::toast::show(app, "info", "No recent screenshot", ""),
        },
        "togglePins" => crate::pins::toggle_visibility(app),
        "closeAllPins" => crate::pins::close_all(app),
        "toggleDesktopIcons" => crate::desktop::toggle(app),
        "hideDesktopIcons" => crate::desktop::set_hidden(app, true),
        "showDesktopIcons" => crate::desktop::set_hidden(app, false),
        "restoreLast" => crate::quick_access::restore(app),
        "openHistory" => crate::commands::open_history(app),
        "closeAllOverlays" => crate::quick_access::close_all(app),
        "saveAllOverlays" => crate::quick_access::save_all(app),
        "hideOverlays" => crate::quick_access::toggle_tucked(app),
        "openSettings" => crate::commands::open_settings(app, None),
        "about" => crate::commands::open_settings(app, Some("about".into())),
        "quit" => app.exit(0),
        _ => log::warn!("unknown action {id}"),
    }
}

pub fn open_from_clipboard(app: &AppHandle) {
    match crate::clipboard::read_image() {
        Some(img) => {
            let path = crate::paths::unique_path(&crate::paths::captures_dir(), &crate::output::file_stem(&state::CaptureKind::Screenshot, "", ""), "png");
            if let Ok(bytes) = crate::imageops::encode_png(&img, 1.0) {
                let _ = std::fs::write(&path, bytes);
                crate::annotate::open(app, &path.to_string_lossy(), None);
            }
        }
        None => crate::toast::show(app, "info", "No image on the clipboard", "Copy an image first, then try again."),
    }
}

pub fn choose_file<F: FnOnce(&AppHandle, String) + Send + 'static>(app: &AppHandle, title: &str, f: F) {
    let app2 = app.clone();
    crate::macos::activate_app(app);
    app.dialog()
        .file()
        .set_title(title)
        .add_filter("Images", &["png", "jpg", "jpeg", "heic", "webp", "tiff", "gif", "screenshotx"])
        .pick_file(move |p| {
            if let Some(p) = p.and_then(|p| p.into_path().ok()) {
                f(&app2, p.to_string_lossy().to_string());
            }
        });
}

pub fn shortcut_for(id: &str) -> Option<String> {
    settings().shortcut(id).map(String::from)
}
