//! Global keyboard shortcuts. Accelerators are stored as
//! "Shift+Super+Digit4" (modifiers + KeyboardEvent.code).

use crate::state::settings;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

static SUSPENDED: AtomicBool = AtomicBool::new(false);
/// Last time each action fired: held keys auto-repeat, and a repeat would
/// toggle the capture overlay straight back off.
static LAST_FIRE: parking_lot::Mutex<Option<std::collections::HashMap<String, std::time::Instant>>> = parking_lot::Mutex::new(None);

fn debounced(id: &str) -> bool {
    let mut g = LAST_FIRE.lock();
    let map = g.get_or_insert_with(Default::default);
    let now = std::time::Instant::now();
    if let Some(t) = map.get(id) {
        if now.duration_since(*t) < std::time::Duration::from_millis(450) {
            map.insert(id.to_string(), now);
            return true;
        }
    }
    map.insert(id.to_string(), now);
    false
}

// ------------------------------------------------------------ session keys
//
// Keyboard events don't reliably reach our non-activating panels while
// another app is active, so during a capture session (and while hovering
// Quick Access) the few keys we need are grabbed as temporary hotkeys and
// forwarded to the webviews as "session-key" events.

static SESSION: parking_lot::Mutex<Option<std::collections::BTreeMap<String, Vec<String>>>> = parking_lot::Mutex::new(None);

#[derive(serde::Serialize, Clone)]
pub struct SessionKey {
    pub acc: String,
    pub down: bool,
}

pub const OVERLAY_KEYS: &[&str] = &[
    "Escape", "Enter", "NumpadEnter", "Space", "Shift+Space",
    "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
    "Shift+ArrowUp", "Shift+ArrowDown", "Shift+ArrowLeft", "Shift+ArrowRight",
    "Super+ArrowUp", "Super+ArrowDown", "Super+ArrowLeft", "Super+ArrowRight",
    "Alt+ArrowUp", "Alt+ArrowDown", "Alt+ArrowLeft", "Alt+ArrowRight",
];

fn session_targets(app: &AppHandle, owner: &str) -> Vec<String> {
    use tauri::Manager;
    match owner {
        // only the overlay of the display under the mouse (the active one):
        // otherwise every display would act on the same key at once
        "overlay" => {
            let active = crate::capture::overlay_label(crate::displays::under_mouse().id);
            if app.get_webview_window(&active).is_some() {
                vec![active]
            } else {
                app.webview_windows().keys().filter(|l| l.starts_with("overlay-")).cloned().collect()
            }
        }
        "scroll" => vec!["scrollprev".into()],
        "qa" => vec!["quickaccess".into()],
        other => vec![other.to_string()],
    }
}

fn register_session_key(app: &AppHandle, owner: &str, acc: &str) {
    let Ok(sc) = acc.parse::<Shortcut>() else { return };
    let gs = app.global_shortcut();
    if gs.is_registered(sc) {
        return;
    }
    let owner = owner.to_string();
    let acc2 = acc.to_string();
    if let Err(e) = gs.on_shortcut(sc, move |app, _sc, ev| {
        use tauri::Emitter;
        let payload = SessionKey { acc: acc2.clone(), down: ev.state == ShortcutState::Pressed };
        for label in session_targets(app, &owner) {
            let _ = app.emit_to(label.as_str(), "session-key", &payload);
        }
    }) {
        log::warn!("session key {acc}: {e}");
    }
}

/// Grab `keys` for `owner` until `end_session_keys` is called.
pub fn session_keys(app: &AppHandle, owner: &str, keys: &[&str]) {
    let fresh: Vec<String> = {
        let mut g = SESSION.lock();
        let map = g.get_or_insert_with(Default::default);
        let list: Vec<String> = keys.iter().map(|k| k.to_string()).collect();
        map.insert(owner.to_string(), list.clone());
        list
    };
    for k in fresh {
        register_session_key(app, owner, &k);
    }
}

pub fn end_session_keys(app: &AppHandle, owner: &str) {
    let removed = SESSION.lock().as_mut().and_then(|m| m.remove(owner)).unwrap_or_default();
    let still: Vec<String> = SESSION.lock().as_ref().map(|m| m.values().flatten().cloned().collect()).unwrap_or_default();
    let user: Vec<String> = settings().shortcuts.values().cloned().collect();
    let gs = app.global_shortcut();
    for k in removed {
        if still.contains(&k) || user.contains(&k) {
            continue;
        }
        if let Ok(sc) = k.parse::<Shortcut>() {
            let _ = gs.unregister(sc);
        }
    }
}

pub fn register_all(app: &AppHandle) {
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let sessions: Vec<(String, Vec<String>)> = SESSION.lock().as_ref().map(|m| m.iter().map(|(k, v)| (k.clone(), v.clone())).collect()).unwrap_or_default();
    for (owner, keys) in sessions {
        for k in keys {
            register_session_key(app, &owner, &k);
        }
    }
    if SUSPENDED.load(Ordering::SeqCst) || std::env::var_os("SX_NO_HOTKEYS").is_some() {
        return;
    }
    let s = settings();
    for (id, acc) in s.shortcuts.iter() {
        if acc.is_empty() {
            continue;
        }
        let sc: Shortcut = match acc.parse() {
            Ok(sc) => sc,
            Err(e) => {
                log::warn!("bad shortcut {acc} for {id}: {e}");
                continue;
            }
        };
        let id = id.clone();
        if gs.is_registered(sc) {
            continue;
        }
        log::info!("registering shortcut {acc} for {id}");
        if let Err(e) = gs.on_shortcut(sc, move |app, _sc, ev| {
            if ev.state == ShortcutState::Pressed && !debounced(&id) {
                crate::actions::run(app, &id);
            }
        }) {
            log::warn!("could not register {acc}: {e}");
        }
    }
    crate::tray::refresh(app);
}

/// Temporarily disable shortcuts while the user records a new one.
pub fn suspend(app: &AppHandle, suspended: bool) {
    SUSPENDED.store(suspended, Ordering::SeqCst);
    register_all(app);
}

/// Returns true if the accelerator can be registered (not taken by the system).
pub fn is_available(app: &AppHandle, acc: &str) -> bool {
    let Ok(sc) = acc.parse::<Shortcut>() else { return false };
    let gs = app.global_shortcut();
    if gs.is_registered(sc) {
        return true;
    }
    match gs.register(sc) {
        Ok(_) => {
            let _ = gs.unregister(sc);
            true
        }
        Err(_) => false,
    }
}

/// Human readable form: "⇧⌘4".
pub fn display(acc: &str) -> String {
    let mut mods = String::new();
    let mut key = String::new();
    for part in acc.split('+') {
        match part {
            "Control" | "Ctrl" => mods.push('⌃'),
            "Alt" | "Option" => mods.push('⌥'),
            "Shift" => mods.push('⇧'),
            "Super" | "Cmd" | "Command" | "Meta" => mods.push('⌘'),
            k => key = key_name(k),
        }
    }
    // macOS order: ⌃⌥⇧⌘
    let order = ['⌃', '⌥', '⇧', '⌘'];
    let mut sorted: String = order.iter().filter(|c| mods.contains(**c)).collect();
    sorted.push_str(&key);
    sorted
}

fn key_name(code: &str) -> String {
    if let Some(k) = code.strip_prefix("Key") {
        return k.to_string();
    }
    if let Some(k) = code.strip_prefix("Digit") {
        return k.to_string();
    }
    match code {
        "Space" => "Space".into(),
        "Enter" => "↩".into(),
        "Escape" => "⎋".into(),
        "Backspace" => "⌫".into(),
        "Tab" => "⇥".into(),
        "ArrowUp" => "↑".into(),
        "ArrowDown" => "↓".into(),
        "ArrowLeft" => "←".into(),
        "ArrowRight" => "→".into(),
        "Minus" => "-".into(),
        "Equal" => "=".into(),
        "BracketLeft" => "[".into(),
        "BracketRight" => "]".into(),
        "Semicolon" => ";".into(),
        "Quote" => "'".into(),
        "Comma" => ",".into(),
        "Period" => ".".into(),
        "Slash" => "/".into(),
        "Backslash" => "\\".into(),
        "Backquote" => "`".into(),
        k => k.to_string(),
    }
}
