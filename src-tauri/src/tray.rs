//! Menu bar icon and menu.

use crate::state::{self, settings};
use std::sync::atomic::Ordering;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem, Submenu};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const TRAY_ID: &str = "main";
static ICON: &[u8] = include_bytes!("../icons/tray.png");
static ICON_REC: &[u8] = include_bytes!("../icons/tray-recording.png");

fn item(app: &AppHandle, id: &str, label: &str) -> tauri::Result<MenuItem<Wry>> {
    let acc = settings().shortcut(id).map(|s| s.to_string());
    MenuItem::with_id(app, id, label, true, acc.as_deref())
}

pub fn build_menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let st = state::state();
    let recording = st.recording.lock().is_some();
    let scrolling = st.scrolling.lock().is_some();
    let icons_hidden = st.desktop_icons_hidden.load(Ordering::SeqCst);
    let sep = || PredefinedMenuItem::separator(app);
    let rec_label = if recording { "Stop Recording".to_string() } else { "Record Screen".to_string() };

    let pins_n = st.pins.lock().len();
    let pins_menu = Submenu::with_items(
        app,
        "Pinned Screenshots",
        pins_n > 0,
        &[
            &MenuItem::with_id(app, "togglePins", if st.pins_hidden.load(Ordering::SeqCst) { "Show Pins" } else { "Hide Pins" }, true, None::<&str>)?,
            &MenuItem::with_id(app, "unlockPins", "Unlock All Pins", true, None::<&str>)?,
            &MenuItem::with_id(app, "closePins", "Close All Pins", true, None::<&str>)?,
        ],
    )?;

    Menu::with_items(
        app,
        &[
            &item(app, "allInOne", "All-In-One")?,
            &sep()?,
            &item(app, "captureArea", "Capture Area")?,
            &item(app, "capturePreviousArea", "Capture Previous Area")?,
            &item(app, "captureFullscreen", "Capture Fullscreen")?,
            &item(app, "captureWindow", "Capture Window")?,
            &item(app, "selfTimer", "Self-Timer")?,
            &item(app, "scrollingCapture", if scrolling { "Finish Scrolling Capture" } else { "Scrolling Capture" })?,
            &item(app, "captureText", "Capture Text (OCR)")?,
            &sep()?,
            &item(app, "recordScreen", &rec_label)?,
            &sep()?,
            &item(app, "openFromClipboard", "Open from Clipboard")?,
            &item(app, "openAnnotate", "Open Annotation Tool...")?,
            &item(app, "pinImage", "Pin to the Screen...")?,
            &pins_menu,
            &sep()?,
            &item(app, "toggleDesktopIcons", if icons_hidden { "Show Desktop Icons" } else { "Hide Desktop Icons" })?,
            &item(app, "restoreLast", "Restore Last Capture")?,
            &item(app, "openHistory", "Capture History...")?,
            &sep()?,
            &MenuItem::with_id(app, "openSettings", "Settings...", true, Some("Super+Comma"))?,
            &MenuItem::with_id(app, "about", "About Screenshot X", true, None::<&str>)?,
            &sep()?,
            &MenuItem::with_id(app, "quit", "Quit Screenshot X", true, Some("Super+KeyQ"))?,
        ],
    )
}

pub fn init(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app)?;
    let tray = TrayIconBuilder::with_id(TRAY_ID)
        .icon(Image::from_bytes(ICON)?)
        .icon_as_template(true)
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(|app, ev| {
            let id = ev.id().as_ref().to_string();
            match id.as_str() {
                "unlockPins" => {
                    let pins = state::state().pins.lock().clone();
                    for p in pins {
                        crate::pins::set_locked(app, &p.label, false);
                    }
                }
                "closePins" => crate::pins::close_all(app),
                _ => crate::actions::run(app, &id),
            }
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                let app = tray.app_handle();
                if state::state().recording.lock().is_some() {
                    crate::recording::stop(app);
                }
            }
        })
        .build(app)?;
    tray.set_visible(settings().show_menu_bar_icon)?;
    Ok(())
}

fn tray(app: &AppHandle) -> Option<TrayIcon<Wry>> {
    app.tray_by_id(TRAY_ID)
}

/// Rebuild the menu (labels, shortcuts, state) and the icon.
pub fn refresh(app: &AppHandle) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        let Some(t) = tray(&app2) else { return };
        let recording = state::state().recording.lock().is_some();
        let _ = t.set_visible(settings().show_menu_bar_icon || recording);
        if let Ok(m) = build_menu(&app2) {
            let _ = t.set_menu(Some(m));
        }
        let _ = t.set_show_menu_on_left_click(!recording);
        let _ = t.set_icon(Image::from_bytes(if recording { ICON_REC } else { ICON }).ok());
        let _ = t.set_icon_as_template(true);
        if !recording {
            let _ = t.set_title(None::<&str>);
        }
    });
}

pub fn set_title(app: &AppHandle, title: Option<String>) {
    let app2 = app.clone();
    let _ = app.run_on_main_thread(move || {
        if let Some(t) = tray(&app2) {
            let _ = t.set_title(title.as_deref());
        }
    });
}
