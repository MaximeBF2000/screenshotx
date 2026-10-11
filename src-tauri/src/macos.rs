//! Thin wrappers over AppKit / CoreGraphics used throughout the app.
//! Functions that touch AppKit must run on the main thread; the
//! `*_main` helpers dispatch there and wait.

use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::{AnyThread, MainThreadMarker, MainThreadOnly};
use objc2_app_kit::{
    NSApplication, NSApplicationActivationOptions, NSApplicationActivationPolicy, NSColor,
    NSColorSpace, NSRunningApplication, NSScreen, NSSound, NSWindow, NSWindowCollectionBehavior,
    NSWorkspace,
};
use objc2_core_graphics::{
    CGEvent, CGEventFlags, CGEventSource, CGEventSourceStateID, CGWindowLevelForKey,
    CGWindowLevelKey,
};
use objc2_foundation::{NSArray, NSString, NSURL};
use std::path::Path;
use tauri::{AppHandle, Runtime, WebviewWindow};

/// Run a closure on the main thread and wait for its result.
pub fn on_main<R: Send + 'static, F: FnOnce(MainThreadMarker) -> R + Send + 'static>(
    app: &AppHandle,
    f: F,
) -> Option<R> {
    if let Some(mtm) = MainThreadMarker::new() {
        return Some(f(mtm));
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let _ = app.run_on_main_thread(move || {
        let mtm = MainThreadMarker::new().expect("main thread");
        let _ = tx.send(f(mtm));
    });
    rx.recv().ok()
}

pub fn ns_window<R: Runtime>(win: &WebviewWindow<R>) -> Option<Retained<NSWindow>> {
    let ptr = win.ns_window().ok()? as *mut NSWindow;
    if ptr.is_null() {
        return None;
    }
    unsafe { Retained::retain(ptr) }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Level {
    /// Above everything, including the menu bar & Dock (capture overlays).
    Overlay,
    /// Floating above normal windows (pins, quick access, controls).
    Floating,
    /// Just above the desktop icons (desktop icon cover).
    DesktopIcons,
    Normal,
}

pub fn level_value(level: Level) -> isize {
    let key = match level {
        Level::Overlay => CGWindowLevelKey::ScreenSaverWindowLevelKey,
        Level::Floating => CGWindowLevelKey::StatusWindowLevelKey,
        Level::DesktopIcons => CGWindowLevelKey::DesktopIconWindowLevelKey,
        Level::Normal => CGWindowLevelKey::NormalWindowLevelKey,
    };
    let base = CGWindowLevelForKey(key) as isize;
    match level {
        Level::DesktopIcons => base + 1,
        Level::Floating => base + 1,
        _ => base,
    }
}

/// Configure an NSWindow to behave like a utility overlay: visible on every
/// Space, over full-screen apps, no shadow, transparent.
pub fn configure_window(win: &NSWindow, level: Level, shadow: bool) {
    win.setLevel(level_value(level));
    let mut behavior = NSWindowCollectionBehavior::CanJoinAllSpaces
        | NSWindowCollectionBehavior::FullScreenAuxiliary
        | NSWindowCollectionBehavior::IgnoresCycle;
    if matches!(level, Level::Overlay | Level::DesktopIcons) {
        behavior |= NSWindowCollectionBehavior::Stationary;
    }
    win.setCollectionBehavior(behavior);
    win.setHasShadow(shadow);
    win.setOpaque(false);
    win.setBackgroundColor(Some(&NSColor::clearColor()));
    unsafe {
        win.setHidesOnDeactivate(false);
    }
}

pub fn configure<R: Runtime>(app: &AppHandle, w: &WebviewWindow<R>, level: Level, shadow: bool) {
    if let Some(nsw) = ns_window(w) {
        let nsw = SendPtr(nsw);
        on_main(app, move |_| {
            let nsw = nsw;
            configure_window(&nsw.0, level, shadow);
        });
    }
}

pub struct SendPtr<T>(pub T);
unsafe impl<T> Send for SendPtr<T> {}

/// Show a window without activating the app (keeps the user's focus).
pub fn order_front<R: Runtime>(app: &AppHandle, w: &WebviewWindow<R>) {
    if let Some(nsw) = ns_window(w) {
        let nsw = SendPtr(nsw);
        on_main(app, move |_| {
            let nsw = nsw;
            nsw.0.orderFrontRegardless();
        });
    }
}

/// Activate our app and make the window key so it receives keyboard events.
pub fn make_key<R: Runtime>(app: &AppHandle, w: &WebviewWindow<R>) {
    if let Some(nsw) = ns_window(w) {
        let nsw = SendPtr(nsw);
        on_main(app, move |mtm| {
            let nsw = nsw;
            let ns_app = NSApplication::sharedApplication(mtm);
            #[allow(deprecated)]
            ns_app.activateIgnoringOtherApps(true);
            nsw.0.makeKeyAndOrderFront(None);
        });
    }
}

pub fn window_number<R: Runtime>(w: &WebviewWindow<R>) -> Option<u32> {
    ns_window(w).map(|n| n.windowNumber() as u32)
}

/// Set an NSWindow frame using CoreGraphics global coordinates
/// (origin top-left of the primary display, y down).
pub fn set_frame_cg<R: Runtime>(app: &AppHandle, w: &WebviewWindow<R>, x: f64, y: f64, width: f64, height: f64) {
    if let Some(nsw) = ns_window(w) {
        let nsw = SendPtr(nsw);
        on_main(app, move |_| {
            let nsw = nsw;
            let primary_h = crate::displays::primary_height();
            let rect = objc2_foundation::NSRect::new(
                objc2_foundation::NSPoint::new(x, primary_h - y - height),
                objc2_foundation::NSSize::new(width, height),
            );
            nsw.0.setFrame_display(rect, true);
        });
    }
}

pub fn set_activation_policy(app: &AppHandle, regular: bool) {
    on_main(app, move |mtm| {
        let ns_app = NSApplication::sharedApplication(mtm);
        ns_app.setActivationPolicy(if regular {
            NSApplicationActivationPolicy::Regular
        } else {
            NSApplicationActivationPolicy::Accessory
        });
    });
}

pub fn activate_app(app: &AppHandle) {
    on_main(app, move |mtm| {
        let ns_app = NSApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        ns_app.activateIgnoringOtherApps(true);
    });
}

#[derive(Clone, Debug, Default, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FrontApp {
    pub pid: i32,
    pub name: String,
    pub bundle_id: String,
}

pub fn frontmost_app() -> Option<FrontApp> {
    let ws = NSWorkspace::sharedWorkspace();
    let app = ws.frontmostApplication()?;
    Some(FrontApp {
        pid: app.processIdentifier(),
        name: app.localizedName().map(|s| s.to_string()).unwrap_or_default(),
        bundle_id: app.bundleIdentifier().map(|s| s.to_string()).unwrap_or_default(),
    })
}

pub fn activate_pid(pid: i32) {
    if pid == std::process::id() as i32 {
        return;
    }
    if let Some(app) = NSRunningApplication::runningApplicationWithProcessIdentifier(pid) {
        #[allow(deprecated)]
        app.activateWithOptions(NSApplicationActivationOptions::ActivateIgnoringOtherApps);
    }
}

/// Mouse location in CG global coordinates (top-left origin).
pub fn mouse_location() -> (f64, f64) {
    let ev = CGEvent::new(None);
    let p = CGEvent::location(ev.as_deref());
    (p.x, p.y)
}

#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct Modifiers {
    pub shift: bool,
    pub ctrl: bool,
    pub alt: bool,
    pub cmd: bool,
}

pub fn modifiers() -> Modifiers {
    let f = CGEventSource::flags_state(CGEventSourceStateID::CombinedSessionState);
    Modifiers {
        shift: f.contains(CGEventFlags::MaskShift),
        ctrl: f.contains(CGEventFlags::MaskControl),
        alt: f.contains(CGEventFlags::MaskAlternate),
        cmd: f.contains(CGEventFlags::MaskCommand),
    }
}

const SOUND_DIRS: &[&str] = &[
    "/System/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system",
    "/System/Library/Library/Components/CoreAudio.component/Contents/SharedSupport/SystemSounds/system",
    "/System/Library/Sounds",
];

fn find_sound(names: &[&str]) -> Option<String> {
    for n in names {
        for d in SOUND_DIRS {
            let p = format!("{d}/{n}");
            if Path::new(&p).exists() {
                return Some(p);
            }
        }
    }
    None
}

pub fn sound_path(kind: &str) -> Option<String> {
    match kind {
        "classic" => find_sound(&["Screen Capture.aif", "Grab.aif", "shutter.aif"]),
        "pop" => find_sound(&["Pop.aiff"]),
        "subtle" => find_sound(&["Tink.aiff"]),
        "glass" => find_sound(&["Glass.aiff"]),
        "tink" => find_sound(&["Tink.aiff"]),
        "start" => find_sound(&["begin_record.caf", "Morse.aiff"]),
        "stop" => find_sound(&["end_record.caf", "Bottle.aiff"]),
        "ocr" => find_sound(&["Purr.aiff", "Tink.aiff"]),
        "countdown" => find_sound(&["Tink.aiff"]),
        "error" => find_sound(&["Basso.aiff"]),
        _ => None,
    }
}

pub fn play_sound(app: &AppHandle, kind: &str) {
    let Some(path) = sound_path(kind) else { return };
    let app = app.clone();
    std::thread::spawn(move || {
        on_main(&app, move |_| unsafe {
            let s = NSSound::alloc();
            if let Some(sound) = NSSound::initWithContentsOfFile_byReference(s, &NSString::from_str(&path), true) {
                sound.play();
                // keep alive until played
                std::mem::forget(sound);
            }
        });
    });
}

pub fn reveal_in_finder(path: &str) {
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let arr = NSArray::from_retained_slice(&[url]);
    NSWorkspace::sharedWorkspace().activateFileViewerSelectingURLs(&arr);
}

/// Move a file to the Trash (recoverable), like Finder's "Move to Trash".
pub fn move_to_trash(path: &str) -> bool {
    let url = NSURL::fileURLWithPath(&NSString::from_str(path));
    let res = objc2_foundation::NSFileManager::defaultManager().trashItemAtURL_resultingItemURL_error(&url, None);
    res.is_ok()
}

pub fn open_url(url: &str) {
    if let Some(u) = NSURL::URLWithString(&NSString::from_str(url)) {
        NSWorkspace::sharedWorkspace().openURL(&u);
    }
}

pub fn open_path(path: &str) {
    let p = Path::new(path);
    if p.is_dir() && p.extension().is_some_and(|e| e == "app") {
        // Finder treats a folder named "*.app" (e.g. a custom storage
        // location) as an application and fails to launch it; selecting an
        // item inside opens a Finder window on the folder's contents instead
        let mut children: Vec<_> = std::fs::read_dir(p).map(|rd| rd.flatten().map(|e| e.path()).collect()).unwrap_or_default();
        children.sort();
        if let Some(first) = children.iter().find(|c| !c.file_name().is_some_and(|n| n.to_string_lossy().starts_with('.'))) {
            reveal_in_finder(&first.to_string_lossy());
            return;
        }
    }
    let u = NSURL::fileURLWithPath(&NSString::from_str(path));
    NSWorkspace::sharedWorkspace().openURL(&u);
}

pub fn emoji_palette(app: &AppHandle) {
    on_main(app, |mtm| {
        NSApplication::sharedApplication(mtm).orderFrontCharacterPalette(None);
    });
}

pub fn accent_color_hex(app: &AppHandle) -> String {
    on_main(app, |_| {
        let c = NSColor::controlAccentColor();
        let srgb = NSColorSpace::sRGBColorSpace();
        if let Some(c) = c.colorUsingColorSpace(&srgb) {
            let r = (c.redComponent() * 255.0).round() as u8;
            let g = (c.greenComponent() * 255.0).round() as u8;
            let b = (c.blueComponent() * 255.0).round() as u8;
            format!("#{r:02X}{g:02X}{b:02X}")
        } else {
            "#007AFF".to_string()
        }
    })
    .unwrap_or_else(|| "#007AFF".into())
}

/// Path of the desktop picture for the screen that contains `display_id`.
pub fn desktop_image_path(app: &AppHandle, display_id: u32) -> Option<String> {
    on_main(app, move |mtm| {
        let screens = NSScreen::screens(mtm);
        for s in screens.iter() {
            if screen_display_id(&s) == Some(display_id) {
                let url = NSWorkspace::sharedWorkspace().desktopImageURLForScreen(&s)?;
                return url.path().map(|p| p.to_string());
            }
        }
        None
    })
    .flatten()
}

pub fn screen_display_id(screen: &NSScreen) -> Option<u32> {
    let desc = screen.deviceDescription();
    let key = NSString::from_str("NSScreenNumber");
    let v = desc.objectForKey(&key)?;
    let num: Option<&objc2_foundation::NSNumber> = v.downcast_ref();
    num.map(|n| n.unsignedIntValue())
}

pub fn is_dark_mode() -> bool {
    std::process::Command::new("defaults")
        .args(["read", "-g", "AppleInterfaceStyle"])
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).contains("Dark"))
        .unwrap_or(false)
}

/// Present the macOS share sheet for files, anchored at a point in the window.
pub fn share_files<R: Runtime>(app: &AppHandle, w: &WebviewWindow<R>, paths: Vec<String>, x: f64, y: f64) {
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    let Some(nsw) = ns_window(w) else { return };
    let nsw = SendPtr(nsw);
    on_main(app, move |mtm| unsafe {
        let nsw = nsw;
        let urls: Vec<Retained<AnyObject>> = paths
            .iter()
            .map(|p| Retained::into_super(Retained::into_super(NSURL::fileURLWithPath(&NSString::from_str(p)))))
            .collect();
        let items = NSArray::from_retained_slice(&urls);
        let picker = NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items);
        let Some(view): Option<Retained<NSView>> = nsw.0.contentView() else { return };
        let h = view.frame().size.height;
        let rect = objc2_foundation::NSRect::new(
            objc2_foundation::NSPoint::new(x, if view.isFlipped() { y } else { h - y }),
            objc2_foundation::NSSize::new(1.0, 1.0),
        );
        let _ = mtm;
        picker.showRelativeToRect_ofView_preferredEdge(rect, &view, objc2_foundation::NSRectEdge::MinY);
        std::mem::forget(picker);
    });
}

/// Show the standard print panel for an image file.
pub fn print_image(app: &AppHandle, path: String) {
    use objc2_app_kit::{NSImage, NSImageView, NSPrintOperation};
    on_main(app, move |mtm| unsafe {
        let Some(img) = NSImage::initWithContentsOfFile(NSImage::alloc(), &NSString::from_str(&path)) else { return };
        let size = img.size();
        let view = NSImageView::initWithFrame(
            NSImageView::alloc(mtm),
            objc2_foundation::NSRect::new(objc2_foundation::NSPoint::new(0.0, 0.0), size),
        );
        view.setImage(Some(&img));
        let op = NSPrintOperation::printOperationWithView(&view);
        op.setShowsPrintPanel(true);
        op.runOperation();
    });
}


/// Ask the system for Screen Recording permission (shows the prompt once).
pub fn has_screen_permission() -> bool {
    objc2_core_graphics::CGPreflightScreenCaptureAccess()
}

pub fn request_screen_permission() -> bool {
    objc2_core_graphics::CGRequestScreenCaptureAccess()
}

pub fn has_accessibility_permission(prompt: bool) -> bool {
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrusted() -> bool;
        fn AXIsProcessTrustedWithOptions(options: *const std::ffi::c_void) -> bool;
    }
    if !prompt {
        return unsafe { AXIsProcessTrusted() };
    }
    use objc2_foundation::{NSDictionary, NSNumber};
    let key = NSString::from_str("AXTrustedCheckOptionPrompt");
    let val = NSNumber::new_bool(true);
    let dict = NSDictionary::from_slices(&[&*key], &[&*val]);
    unsafe { AXIsProcessTrustedWithOptions(Retained::as_ptr(&dict) as *const _) }
}

pub fn open_privacy_settings(pane: &str) {
    let url = format!("x-apple.systempreferences:com.apple.preference.security?{pane}");
    open_url(&url);
}

/// Visible frame (excluding menu bar and Dock) of a display, in CG global
/// coordinates.
pub fn visible_frame(app: &AppHandle, display_id: u32) -> Option<(f64, f64, f64, f64)> {
    on_main(app, move |mtm| {
        let primary_h = crate::displays::primary_height();
        for s in NSScreen::screens(mtm).iter() {
            if screen_display_id(&s) == Some(display_id) {
                let f = s.visibleFrame();
                return Some((f.origin.x, primary_h - f.origin.y - f.size.height, f.size.width, f.size.height));
            }
        }
        None
    })
    .flatten()
}

/// Allow our (inactive, accessory) app to change the cursor while a
/// non-activating overlay is under the mouse — the same private CGS
/// connection property screenshot tools rely on.
pub fn enable_background_cursor() {
    #[link(name = "CoreGraphics", kind = "framework")]
    extern "C" {
        fn _CGSDefaultConnection() -> i32;
        fn CGSSetConnectionProperty(cid: i32, target: i32, key: *const std::ffi::c_void, value: *const std::ffi::c_void) -> i32;
    }
    unsafe {
        let key = objc2_core_foundation::CFString::from_static_str("SetsCursorInBackground");
        let val = objc2_core_foundation::CFBoolean::new(true);
        let cid = _CGSDefaultConnection();
        CGSSetConnectionProperty(
            cid,
            cid,
            objc2_core_foundation::CFRetained::as_ptr(&key).as_ptr() as *const _,
            val as *const objc2_core_foundation::CFBoolean as *const _,
        );
    }
}

/// Like `set_frame_cg`, with AppKit's window resize/move animation.
pub fn animate_frame_cg<R: Runtime>(app: &AppHandle, w: &WebviewWindow<R>, x: f64, y: f64, width: f64, height: f64) {
    if let Some(nsw) = ns_window(w) {
        let nsw = SendPtr(nsw);
        on_main(app, move |_| {
            let nsw = nsw;
            let primary_h = crate::displays::primary_height();
            let rect = objc2_foundation::NSRect::new(
                objc2_foundation::NSPoint::new(x, primary_h - y - height),
                objc2_foundation::NSSize::new(width, height),
            );
            nsw.0.setFrame_display_animate(rect, true, true);
        });
    }
}
