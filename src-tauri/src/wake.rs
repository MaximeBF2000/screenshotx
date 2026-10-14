//! Recover from sleep, screen lock and display changes.
//!
//! The capture overlays are created once and reused, so they can appear
//! instantly. After the Mac wakes, the screen unlocks or displays are plugged
//! in / rearranged, those windows could stay unusable: the overlay loaded the
//! session but never showed up, until the app was relaunched. So on any of
//! these events the overlays are thrown away and created again.

use crate::macos;
use block2::RcBlock;
use objc2_app_kit::{
    NSApplicationDidChangeScreenParametersNotification, NSWorkspace, NSWorkspaceDidWakeNotification,
    NSWorkspaceScreensDidWakeNotification, NSWorkspaceSessionDidBecomeActiveNotification,
};
use objc2_foundation::{NSDistributedNotificationCenter, NSNotification, NSNotificationCenter, NSNotificationName, NSString};
use std::ptr::NonNull;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::AppHandle;

/// Events often come in bursts (wake, then screens wake, then unlock...):
/// only the last one of a burst rebuilds.
static LAST_EVENT: AtomicU64 = AtomicU64::new(0);
const SETTLE: Duration = Duration::from_millis(600);

/// Start listening (once, at launch).
pub fn observe(app: &AppHandle) {
    let app = app.clone();
    macos::on_main(&app.clone(), move |_| {
        let workspace = NSWorkspace::sharedWorkspace().notificationCenter();
        let local = NSNotificationCenter::defaultCenter();
        let distributed = NSDistributedNotificationCenter::defaultCenter();
        let unlocked = NSString::from_str("com.apple.screenIsUnlocked");
        unsafe {
            add(&workspace, NSWorkspaceDidWakeNotification, &app);
            add(&workspace, NSWorkspaceScreensDidWakeNotification, &app);
            add(&workspace, NSWorkspaceSessionDidBecomeActiveNotification, &app);
            add(&local, NSApplicationDidChangeScreenParametersNotification, &app);
            add(&distributed, &unlocked, &app);
        }
    });
}

unsafe fn add(center: &NSNotificationCenter, name: &NSNotificationName, app: &AppHandle) {
    let app = app.clone();
    let event = name.to_string();
    let block = RcBlock::new(move |_: NonNull<NSNotification>| on_event(&app, &event));
    let token = center.addObserverForName_object_queue_usingBlock(Some(name), None, None, &block);
    // observers live as long as the app
    std::mem::forget(token);
}

fn on_event(app: &AppHandle, event: &str) {
    log::info!("system event: {event}");
    let id = LAST_EVENT.fetch_add(1, Ordering::SeqCst) + 1;
    let app = app.clone();
    std::thread::spawn(move || {
        // let the displays settle, and keep only the last event of a burst
        std::thread::sleep(SETTLE);
        if LAST_EVENT.load(Ordering::SeqCst) != id {
            return;
        }
        // never pull the overlays from under a capture in progress
        while crate::capture::is_busy() {
            std::thread::sleep(Duration::from_millis(500));
        }
        crate::capture::rebuild_overlays(&app);
        crate::quick_access::relayout(&app);
    });
}
