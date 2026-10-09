//! Mouse hover tracking for our non-activating panels. WebKit doesn't
//! deliver hover (mouse moved) events to windows of an inactive app, so the
//! cursor position is polled and forwarded as "hover" events.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Emitter, Manager};

static TRACKED: parking_lot::Mutex<BTreeMap<String, Option<(f64, f64)>>> = parking_lot::Mutex::new(BTreeMap::new());
static RUNNING: AtomicBool = AtomicBool::new(false);

pub fn track(app: &AppHandle, label: &str) {
    TRACKED.lock().entry(label.to_string()).or_insert(None);
    if RUNNING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || loop {
        std::thread::sleep(std::time::Duration::from_millis(33));
        let labels: Vec<String> = TRACKED.lock().keys().cloned().collect();
        if labels.is_empty() {
            RUNNING.store(false, Ordering::SeqCst);
            return;
        }
        let frames = own_frames();
        let (mx, my) = crate::macos::mouse_location();
        for label in labels {
            let Some(w) = app.get_webview_window(&label) else {
                TRACKED.lock().remove(&label);
                continue;
            };
            let num = crate::macos::window_number(&w);
            let frame = num.and_then(|n| frames.iter().find(|f| f.0 == n).map(|f| f.1));
            let pos = frame.and_then(|(x, y, fw, fh)| {
                (mx >= x && mx < x + fw && my >= y && my < y + fh).then_some((mx - x, my - y))
            });
            let prev = TRACKED.lock().get(&label).cloned().flatten();
            if pos != prev {
                TRACKED.lock().insert(label.clone(), pos);
                let _ = w.emit_to(label.as_str(), "hover", pos);
                if label == "quickaccess" {
                    // Space = Quick Look, Esc = close while hovering a thumbnail
                    match (prev.is_some(), pos.is_some()) {
                        (false, true) => crate::hotkeys::session_keys(&app, "qa", &["Space", "Escape"]),
                        (true, false) => crate::hotkeys::end_session_keys(&app, "qa"),
                        _ => {}
                    }
                }
            }
        }
    });
}

pub fn untrack(app: &AppHandle, label: &str) {
    let was = TRACKED.lock().remove(label).flatten();
    if was.is_some() && label == "quickaccess" {
        crate::hotkeys::end_session_keys(app, "qa");
    }
}

/// (window number, CG frame) of our on-screen windows.
fn own_frames() -> Vec<(u32, (f64, f64, f64, f64))> {
    use objc2_core_graphics::{CGWindowListCopyWindowInfo, CGWindowListOption};
    use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString};
    let Some(arr) = CGWindowListCopyWindowInfo(CGWindowListOption::OptionOnScreenOnly, 0) else { return vec![] };
    let arr: &NSArray<NSDictionary<NSString, objc2::runtime::AnyObject>> =
        unsafe { &*(objc2_core_foundation::CFRetained::as_ptr(&arr).as_ptr() as *const _) };
    let own = std::process::id() as f64;
    let num = |d: &NSDictionary<NSString, objc2::runtime::AnyObject>, k: &str| -> f64 {
        d.objectForKey(&NSString::from_str(k)).and_then(|v| v.downcast::<NSNumber>().ok()).map(|n| n.doubleValue()).unwrap_or(0.0)
    };
    arr.iter()
        .filter(|d| num(d, "kCGWindowOwnerPID") == own)
        .filter_map(|d| {
            let b = d.objectForKey(&NSString::from_str("kCGWindowBounds"))?.downcast::<NSDictionary>().ok()?;
            let b: objc2::rc::Retained<NSDictionary<NSString, objc2::runtime::AnyObject>> = unsafe { objc2::rc::Retained::cast_unchecked(b) };
            Some((num(&d, "kCGWindowNumber") as u32, (num(&b, "X"), num(&b, "Y"), num(&b, "Width"), num(&b, "Height"))))
        })
        .collect()
}
