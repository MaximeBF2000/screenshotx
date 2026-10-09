//! "Hide Desktop Icons": cover the icons with borderless windows that show
//! the wallpaper (or a custom image / plain color), just above the icon layer.

use crate::displays::{self, Display};
use crate::macos::{self, Level, SendPtr};
use crate::settings::WallpaperSource;
use crate::state::{self, settings};
use image::RgbaImage;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::MainThreadOnly;
use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowCollectionBehavior, NSWindowStyleMask};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::collections::HashMap;
use std::sync::atomic::Ordering;
use tauri::{AppHandle, Emitter};

static COVERS: parking_lot::Mutex<Vec<SendPtr<Retained<NSWindow>>>> = parking_lot::Mutex::new(Vec::new());
static WALLPAPERS: parking_lot::Mutex<Option<HashMap<u32, RgbaImage>>> = parking_lot::Mutex::new(None);

/// The image used behind window screenshots / the icon cover for a display.
pub fn wallpaper_image(app: &AppHandle, d: &Display) -> Option<RgbaImage> {
    let s = settings();
    match s.wallpaper_source {
        WallpaperSource::Custom if !s.custom_wallpaper_path.is_empty() => {
            crate::imageops::load(std::path::Path::new(&s.custom_wallpaper_path)).ok()
        }
        WallpaperSource::PlainColor => Some(RgbaImage::from_pixel(
            16,
            16,
            image::Rgba(crate::imageops::parse_hex(&s.wallpaper_plain_color)),
        )),
        _ => {
            if let Some(img) = WALLPAPERS.lock().as_ref().and_then(|m| m.get(&d.id).cloned()) {
                return Some(img);
            }
            let img = crate::sck::shareable_content()
                .ok()
                .and_then(|c| crate::sck::capture_wallpaper(&c, d))
                .or_else(|| {
                    macos::desktop_image_path(app, d.id)
                        .and_then(|p| crate::imageops::load(std::path::Path::new(&p)).ok())
                });
            if let Some(i) = &img {
                WALLPAPERS.lock().get_or_insert_with(HashMap::new).insert(d.id, i.clone());
            }
            img
        }
    }
}

pub fn invalidate_wallpaper_cache() {
    *WALLPAPERS.lock() = None;
}

pub fn set_hidden(app: &AppHandle, hidden: bool) {
    let st = state::state();
    if hidden {
        invalidate_wallpaper_cache();
        let imgs: Vec<(Display, Option<RgbaImage>)> =
            displays::list().into_iter().map(|d| {
                let img = wallpaper_image(app, &d);
                (d, img)
            }).collect();
        let prepared: Vec<(Display, Option<SendPtr<objc2_core_foundation::CFRetained<objc2_core_graphics::CGImage>>>)> = imgs
            .into_iter()
            .map(|(d, img)| (d, img.and_then(|i| crate::nativeimage::rgba_to_cgimage(&i)).map(SendPtr)))
            .collect();
        let prepared = SendPtr(prepared);
        macos::on_main(app, move |mtm| {
            let prepared = prepared;
            let mut covers = COVERS.lock();
            for c in covers.drain(..) {
                c.0.orderOut(None);
            }
            let primary_h = displays::primary_height();
            for (d, cg) in prepared.0.iter() {
                let rect = NSRect::new(NSPoint::new(d.x, primary_h - d.y - d.height), NSSize::new(d.width, d.height));
                let win = unsafe {
                    NSWindow::initWithContentRect_styleMask_backing_defer(
                        NSWindow::alloc(mtm),
                        rect,
                        NSWindowStyleMask::Borderless,
                        NSBackingStoreType::Buffered,
                        false,
                    )
                };
                unsafe { win.setReleasedWhenClosed(false) };
                win.setLevel(macos::level_value(Level::DesktopIcons));
                win.setCollectionBehavior(
                    NSWindowCollectionBehavior::CanJoinAllSpaces
                        | NSWindowCollectionBehavior::Stationary
                        | NSWindowCollectionBehavior::IgnoresCycle,
                );
                win.setIgnoresMouseEvents(true);
                win.setHasShadow(false);
                win.setBackgroundColor(Some(&objc2_app_kit::NSColor::blackColor()));
                if let Some(view) = win.contentView() {
                    view.setWantsLayer(true);
                    if let (Some(layer), Some(cg)) = (view.layer(), cg) {
                        unsafe {
                            let obj: &AnyObject = &*(objc2_core_foundation::CFRetained::as_ptr(&cg.0).as_ptr() as *const AnyObject);
                            layer.setContents(Some(obj));
                            layer.setContentsGravity(&NSString::from_str("resizeAspectFill"));
                        }
                    }
                }
                win.orderFrontRegardless();
                covers.push(SendPtr(win));
            }
        });
        st.desktop_icons_hidden.store(true, Ordering::SeqCst);
    } else {
        macos::on_main(app, |_| {
            let mut covers = COVERS.lock();
            for c in covers.drain(..) {
                c.0.orderOut(None);
            }
        });
        st.desktop_icons_hidden.store(false, Ordering::SeqCst);
    }
    let _ = app.emit("desktop-icons", hidden);
    crate::tray::refresh(app);
}

pub fn toggle(app: &AppHandle) {
    let hidden = state::state().desktop_icons_hidden.load(Ordering::SeqCst);
    set_hidden(app, !hidden);
}
