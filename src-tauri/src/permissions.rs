use crate::macos;
use tauri::AppHandle;
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};

pub fn prompt_screen_recording(app: &AppHandle) {
    // Registers the app in System Settings' list (and shows the system
    // prompt the first time).
    let granted = macos::request_screen_permission();
    if granted {
        return;
    }
    let app2 = app.clone();
    app.dialog()
        .message(
            "In order to continue working properly, Screenshot X needs Screen Recording permission.\n\n\
             Open System Settings → Privacy & Security → Screen & System Audio Recording and enable Screenshot X. \
             You may need to relaunch the app afterwards.",
        )
        .title("Screenshot X requires Screen Recording permission")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Open System Settings".into(), "Later".into()))
        .show(move |open| {
            if open {
                macos::open_privacy_settings("Privacy_ScreenCapture");
            }
            let _ = app2;
        });
}

pub fn prompt_accessibility(app: &AppHandle, reason: &str) {
    if macos::has_accessibility_permission(false) {
        return;
    }
    macos::has_accessibility_permission(true);
    let _ = app;
    log::info!("accessibility requested: {reason}");
}
