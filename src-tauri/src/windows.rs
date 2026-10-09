//! Window factory. Utility surfaces (capture overlay, Quick Access, pins,
//! recording controls, toasts) are non-activating NSPanels so they never
//! steal focus from the app being captured; editors are regular windows.

use crate::macos::{self, Level};
use objc2::Message;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tauri_nspanel::{CollectionBehavior, ManagerExt, StyleMask, WebviewWindowExt};

mod key_panel {
    tauri_nspanel::tauri_panel!(KeyPanel {
        config: {
            can_become_key_window: true,
            is_floating_panel: true
        }
    });
}
mod passive_panel {
    tauri_nspanel::tauri_panel!(PassivePanel {
        config: {
            can_become_key_window: false,
            is_floating_panel: true
        }
    });
}
pub use key_panel::KeyPanel;
pub use passive_panel::PassivePanel;

#[derive(Clone, Copy, PartialEq)]
pub enum PanelKind {
    /// Can become key (receives keyboard) without activating the app.
    Key,
    /// Never key; purely visual / click-through.
    Passive,
}

pub struct Spec<'a> {
    pub label: &'a str,
    pub view: &'a str,
    pub query: Vec<(&'a str, String)>,
    pub title: &'a str,
    pub width: f64,
    pub height: f64,
    /// CG global position; centered if None
    pub pos: Option<(f64, f64)>,
    pub panel: Option<PanelKind>,
    pub level: Level,
    pub transparent: bool,
    pub decorations: bool,
    pub resizable: bool,
    pub shadow: bool,
    pub visible: bool,
    pub min_size: Option<(f64, f64)>,
    /// regular windows: title bar overlay with hidden title (custom toolbars)
    pub overlay_titlebar: bool,
    pub click_through: bool,
}

impl<'a> Spec<'a> {
    pub fn new(label: &'a str, view: &'a str) -> Self {
        Self {
            label,
            view,
            query: vec![],
            title: "Screenshot X",
            width: 800.0,
            height: 600.0,
            pos: None,
            panel: None,
            level: Level::Normal,
            transparent: false,
            decorations: true,
            resizable: true,
            shadow: true,
            visible: true,
            min_size: None,
            overlay_titlebar: false,
            click_through: false,
        }
    }
}

pub fn url_for(view: &str, query: &[(&str, String)]) -> WebviewUrl {
    let mut q = format!("index.html?view={view}");
    for (k, v) in query {
        q.push('&');
        q.push_str(k);
        q.push('=');
        q.push_str(&urlencoding::encode(v));
    }
    WebviewUrl::App(q.into())
}

pub fn get(app: &AppHandle, label: &str) -> Option<WebviewWindow> {
    app.get_webview_window(label)
}

pub fn create(app: &AppHandle, spec: Spec) -> tauri::Result<WebviewWindow> {
    if let Some(w) = app.get_webview_window(spec.label) {
        return Ok(w);
    }
    let mut b = WebviewWindowBuilder::new(app, spec.label, url_for(spec.view, &spec.query))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .visible(false)
        .resizable(spec.resizable)
        .decorations(spec.decorations)
        .transparent(spec.transparent)
        .shadow(spec.shadow)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .focused(false)
        .background_color(tauri::window::Color(0, 0, 0, 0))
        .disable_drag_drop_handler();
    if spec.view == "annotate" || spec.view == "prefs" {
        // These handle native file drops (images dropped onto the canvas).
        b = WebviewWindowBuilder::new(app, spec.label, url_for(spec.view, &spec.query))
            .title(spec.title)
            .inner_size(spec.width, spec.height)
            .visible(false)
            .resizable(spec.resizable)
            .decorations(spec.decorations)
            .transparent(spec.transparent)
            .shadow(spec.shadow)
            .accept_first_mouse(true)
            .focused(false);
    }
    if let Some((w, h)) = spec.min_size {
        b = b.min_inner_size(w, h);
    }
    if spec.view == "camera" {
        // the system camera permission still applies; skip WebKit's extra prompt
        b = b.on_permission_request(|_, kind| match kind {
            tauri::webview::PermissionKind::Camera | tauri::webview::PermissionKind::Microphone => tauri::webview::PermissionResponse::Allow,
            _ => tauri::webview::PermissionResponse::Default,
        });
    }
    if spec.overlay_titlebar {
        b = b
            .title_bar_style(tauri::TitleBarStyle::Overlay)
            .hidden_title(true)
            .traffic_light_position(tauri::LogicalPosition::new(16.0, 22.0));
    }
    if spec.pos.is_none() {
        b = b.center();
    }
    if spec.panel.is_some() {
        // join every Space from creation, before anything orders it front
        b = b.visible_on_all_workspaces(true);
    }
    let win = b.build()?;

    if let Some((x, y)) = spec.pos {
        macos::set_frame_cg(app, &win, x, y, spec.width, spec.height);
    }

    if let Some(kind) = spec.panel {
        let app2 = app.clone();
        let w2 = win.clone();
        let level = spec.level;
        let click_through = spec.click_through;
        let shadow = spec.shadow;
        macos::on_main(app, move |_| {
            let panel = match kind {
                PanelKind::Key => w2.to_panel::<KeyPanel>(),
                PanelKind::Passive => w2.to_panel::<PassivePanel>(),
            };
            if let Ok(panel) = panel {
                if let Err(e) = panel.set_style_mask(StyleMask::empty().borderless().nonactivating_panel().value()) {
                    log::error!("panel style mask failed: {e}");
                }
                // setFloatingPanel: resets the level to NSFloatingWindowLevel (3,
                // below the menu bar), so it must come before set_level
                panel.set_floating_panel(true);
                panel.set_level(macos::level_value(level) as i64);
                let mut cb = CollectionBehavior::new().can_join_all_spaces().full_screen_auxiliary().ignores_cycle();
                if matches!(level, Level::Overlay) {
                    cb = cb.stationary();
                }
                panel.set_collection_behavior(cb.value());
                panel.set_hides_on_deactivate(false);
                panel.set_has_shadow(shadow);
                panel.set_opaque(false);
                panel.set_works_when_modal(true);
                panel.set_accepts_mouse_moved_events(true);
                if click_through {
                    panel.set_ignores_mouse_events(true);
                }
            }
            let _ = app2;
        });
    } else if spec.level != Level::Normal {
        macos::configure(app, &win, spec.level, spec.shadow);
    } else if let Some(nsw) = macos::ns_window(&win) {
        // Editors / Settings follow you to the current Space instead of
        // switching desktops when they're shown or become key.
        let nsw = macos::SendPtr(nsw);
        macos::on_main(app, move |_| {
            let nsw = nsw;
            nsw.0.setCollectionBehavior(objc2_app_kit::NSWindowCollectionBehavior::MoveToActiveSpace);
        });
    }

    if spec.visible {
        show(app, &win, spec.panel.is_none());
    }
    Ok(win)
}

/// Show a window. Regular windows activate the app and become key; panels
/// are ordered front without stealing focus.
pub fn show(app: &AppHandle, win: &WebviewWindow, activate: bool) {
    let label = win.label().to_string();
    if let Ok(panel) = app.get_webview_panel(&label) {
        let app2 = app.clone();
        macos::on_main(app, move |_| {
            let _ = app2;
            panel.order_front_regardless();
        });
        return;
    }
    let _ = win.show();
    if activate {
        macos::make_key(app, win);
        let _ = win.set_focus();
    } else {
        macos::order_front(app, win);
    }
}

/// Find the WKWebView inside a view hierarchy.
fn find_webview(view: &objc2_app_kit::NSView) -> Option<objc2::rc::Retained<objc2_app_kit::NSView>> {
    let name = view.class().name().to_string_lossy().to_string();
    if name.contains("WebView") {
        return Some(view.retain());
    }
    for sub in view.subviews().iter() {
        if let Some(v) = find_webview(&sub) {
            return Some(v);
        }
    }
    None
}

/// Make a key panel key (keyboard focus) without activating the app, and
/// give the web view first-responder status so key events reach the page.
pub fn make_key(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        macos::on_main(app, move |_| {
            panel.show_and_make_key();
            let content = panel.content_view();
            if let Some(wv) = find_webview(&content) {
                let responder: &objc2_app_kit::NSResponder = &wv;
                let _ = panel.make_first_responder(Some(responder));
            }
        });
    } else if let Some(w) = app.get_webview_window(label) {
        macos::make_key(app, &w);
    }
}

pub fn hide(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        macos::on_main(app, move |_| {
            // resign first so AppKit doesn't pick another of our windows
            // (possibly on another Space) as the new key window
            if panel.as_panel().isKeyWindow() {
                panel.resign_key_window();
            }
            panel.hide();
        });
    } else if let Some(w) = app.get_webview_window(label) {
        let _ = w.hide();
    }
}

pub fn close(app: &AppHandle, label: &str) {
    if let Ok(panel) = app.get_webview_panel(label) {
        let app2 = app.clone();
        let label = label.to_string();
        macos::on_main(app, move |_| {
            if panel.as_panel().isKeyWindow() {
                panel.resign_key_window();
            }
            panel.hide();
            // `to_window` unregisters the panel and restores the NSWindow
            // class, which must happen before Tauri tears the window down.
            match panel.to_window() {
                Some(w) => {
                    let _ = w.destroy();
                }
                None => {
                    if let Some(w) = app2.get_webview_window(&label) {
                        let _ = w.destroy();
                    }
                }
            }
        });
    } else if let Some(w) = app.get_webview_window(label) {
        let _ = w.destroy();
    }
}

pub fn set_ignore_mouse(app: &AppHandle, label: &str, ignore: bool) {
    if let Ok(panel) = app.get_webview_panel(label) {
        macos::on_main(app, move |_| {
            panel.set_ignores_mouse_events(ignore);
        });
    } else if let Some(w) = app.get_webview_window(label) {
        let _ = w.set_ignore_cursor_events(ignore);
    }
}

pub fn set_alpha(app: &AppHandle, label: &str, alpha: f64) {
    if let Ok(panel) = app.get_webview_panel(label) {
        macos::on_main(app, move |_| {
            panel.set_alpha_value(alpha);
        });
    }
}

pub fn set_level(app: &AppHandle, label: &str, level: Level) {
    if let Ok(panel) = app.get_webview_panel(label) {
        macos::on_main(app, move |_| {
            panel.set_level(macos::level_value(level) as i64);
        });
    } else if let Some(w) = app.get_webview_window(label) {
        macos::configure(app, &w, level, true);
    }
}

pub fn is_visible(app: &AppHandle, label: &str) -> bool {
    app.get_webview_window(label).and_then(|w| w.is_visible().ok()).unwrap_or(false)
}

/// Window numbers of our windows that must never appear in captures.
/// Capture UI (selection overlays, Quick Access, toasts, recording
/// controls...) is never captured; editors, Settings, History etc. are.
fn is_capture_ui(label: &str) -> bool {
    label.starts_with("overlay-")
        || label.starts_with("recframe-")
        || label.starts_with("renderer-")
        || matches!(label, "quickaccess" | "toast" | "countdown" | "recctl" | "scrollprev")
}

pub fn excluded_window_numbers(app: &AppHandle, include_pins: bool) -> Vec<u32> {
    let mut out = vec![];
    for (label, w) in app.webview_windows() {
        let exclude = is_capture_ui(&label) || (!include_pins && label.starts_with("pin-"));
        if !exclude {
            continue;
        }
        if let Some(n) = macos::window_number(&w) {
            out.push(n);
        }
    }
    out
}

/// Our own windows that can be picked in window-capture mode.
pub fn capturable_own_windows(app: &AppHandle, include_pins: bool) -> Vec<u32> {
    app.webview_windows()
        .into_iter()
        .filter(|(label, _)| !is_capture_ui(label) && (include_pins || !label.starts_with("pin-")) && !label.starts_with("recfx-") && label != "camera")
        .filter_map(|(_, w)| macos::window_number(&w))
        .collect()
}

/// Simple centered regular window (preferences, history, onboarding...).
pub fn open_regular(app: &AppHandle, label: &str, view: &str, title: &str, w: f64, h: f64, resizable: bool) -> Option<WebviewWindow> {
    if let Some(win) = app.get_webview_window(label) {
        show(app, &win, true);
        return Some(win);
    }
    let mut spec = Spec::new(label, view);
    spec.title = title;
    spec.width = w;
    spec.height = h;
    spec.resizable = resizable;
    spec.overlay_titlebar = true;
    spec.visible = false;
    let win = create(app, spec).ok()?;
    Some(win)
}
