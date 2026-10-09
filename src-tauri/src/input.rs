//! Global mouse / keyboard monitors used during recordings to draw click
//! highlights and keystroke badges (NSEvent global monitors; keyboard
//! events require the Accessibility permission).

use crate::macos::{self, SendPtr};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2_app_kit::{NSEvent, NSEventMask, NSEventModifierFlags, NSEventType};
use serde::Serialize;
use std::ptr::NonNull;
use tauri::{AppHandle, Emitter};

static MONITORS: parking_lot::Mutex<Vec<SendPtr<Retained<AnyObject>>>> = parking_lot::Mutex::new(Vec::new());

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ClickEvent {
    /// CG global coordinates
    pub x: f64,
    pub y: f64,
    pub button: i64,
    pub down: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KeyEvent {
    pub label: String,
    pub has_command_modifier: bool,
}

fn key_name(code: u16, chars: &str) -> String {
    match code {
        36 | 76 => "↩".into(),
        48 => "⇥".into(),
        49 => "Space".into(),
        51 => "⌫".into(),
        117 => "⌦".into(),
        53 => "⎋".into(),
        123 => "←".into(),
        124 => "→".into(),
        125 => "↓".into(),
        126 => "↑".into(),
        116 => "⇞".into(),
        121 => "⇟".into(),
        115 => "↖".into(),
        119 => "↘".into(),
        122 => "F1".into(),
        120 => "F2".into(),
        99 => "F3".into(),
        118 => "F4".into(),
        96 => "F5".into(),
        97 => "F6".into(),
        98 => "F7".into(),
        100 => "F8".into(),
        101 => "F9".into(),
        109 => "F10".into(),
        103 => "F11".into(),
        111 => "F12".into(),
        _ => chars.to_uppercase(),
    }
}

pub fn start(app: &AppHandle, clicks: bool, keys: bool) {
    stop(app);
    let app2 = app.clone();
    macos::on_main(app, move |_| {
        let mut mons = MONITORS.lock();
        if clicks {
            let app3 = app2.clone();
            let block = RcBlock::new(move |ev: NonNull<NSEvent>| {
                let ev = unsafe { ev.as_ref() };
                let t = ev.r#type();
                let down = matches!(t, NSEventType::LeftMouseDown | NSEventType::RightMouseDown | NSEventType::OtherMouseDown);
                let (x, y) = macos::mouse_location();
                let _ = app3.emit("fx:click", ClickEvent { x, y, button: ev.buttonNumber() as i64, down });
            });
            let mask = NSEventMask::LeftMouseDown
                | NSEventMask::LeftMouseUp
                | NSEventMask::RightMouseDown
                | NSEventMask::RightMouseUp
                | NSEventMask::OtherMouseDown;
            if let Some(m) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(mask, &block) {
                mons.push(SendPtr(m));
            }
        }
        if keys {
            let app3 = app2.clone();
            let block = RcBlock::new(move |ev: NonNull<NSEvent>| {
                let ev = unsafe { ev.as_ref() };
                if ev.r#type() != NSEventType::KeyDown {
                    return;
                }
                let f = ev.modifierFlags();
                let mut label = String::new();
                if f.contains(NSEventModifierFlags::Control) {
                    label.push('⌃');
                }
                if f.contains(NSEventModifierFlags::Option) {
                    label.push('⌥');
                }
                if f.contains(NSEventModifierFlags::Shift) {
                    label.push('⇧');
                }
                if f.contains(NSEventModifierFlags::Command) {
                    label.push('⌘');
                }
                let chars = ev.charactersIgnoringModifiers().map(|s| s.to_string()).unwrap_or_default();
                label.push_str(&key_name(ev.keyCode(), &chars));
                let cmd = f.intersects(NSEventModifierFlags::Command | NSEventModifierFlags::Control | NSEventModifierFlags::Option);
                let _ = app3.emit("fx:key", KeyEvent { label, has_command_modifier: cmd });
            });
            if let Some(m) = NSEvent::addGlobalMonitorForEventsMatchingMask_handler(NSEventMask::KeyDown, &block) {
                mons.push(SendPtr(m));
            }
        }
    });
}

pub fn stop(app: &AppHandle) {
    macos::on_main(app, |_| {
        let mut mons = MONITORS.lock();
        for m in mons.drain(..) {
            unsafe { NSEvent::removeMonitor(&m.0) };
        }
    });
}
