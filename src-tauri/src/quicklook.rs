//! Quick Look preview (Space on a Quick Access thumbnail / history item).

use std::process::{Child, Command, Stdio};

static CURRENT: parking_lot::Mutex<Option<Child>> = parking_lot::Mutex::new(None);

pub fn preview(path: &str) {
    let mut cur = CURRENT.lock();
    // Space toggles: a second press closes the running preview.
    if let Some(mut c) = cur.take() {
        if c.try_wait().ok().flatten().is_none() {
            let _ = c.kill();
            return;
        }
    }
    if let Ok(child) = Command::new("/usr/bin/qlmanage")
        .args(["-p", path])
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
    {
        // qlmanage opens its panel behind the active app: bring it forward
        let pid = child.id() as i32;
        std::thread::spawn(move || {
            for _ in 0..10 {
                std::thread::sleep(std::time::Duration::from_millis(120));
                if let Some(app) = objc2_app_kit::NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
                    #[allow(deprecated)]
                    app.activateWithOptions(objc2_app_kit::NSApplicationActivationOptions::ActivateIgnoringOtherApps);
                    break;
                }
            }
        });
        *cur = Some(child);
    }
}
