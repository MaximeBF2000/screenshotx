//! ScreenCaptureKit + CoreGraphics capture primitives.

use anyhow::{anyhow, Result};
use block2::RcBlock;
use image::RgbaImage;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapContextCreate, CGColorSpace, CGContext, CGImage, CGWindowListCopyWindowInfo,
    CGWindowListOption,
};
use objc2_foundation::{NSArray, NSDictionary, NSError, NSNumber, NSString};
use objc2_screen_capture_kit::{
    SCContentFilter, SCDisplay, SCScreenshotManager, SCShareableContent, SCStreamConfiguration, SCWindow,
};
use serde::Serialize;
use std::sync::mpsc;
use std::time::Duration;

pub struct Shareable(pub Retained<SCShareableContent>);
unsafe impl Send for Shareable {}
unsafe impl Sync for Shareable {}

pub fn shareable_content() -> Result<Shareable> {
    let (tx, rx) = mpsc::channel::<Result<Shareable, String>>();
    let block = RcBlock::new(move |content: *mut SCShareableContent, err: *mut NSError| {
        if content.is_null() {
            let msg = if err.is_null() {
                "no shareable content".to_string()
            } else {
                unsafe { (*err).localizedDescription().to_string() }
            };
            let _ = tx.send(Err(msg));
        } else {
            let c = unsafe { Retained::retain(content).unwrap() };
            let _ = tx.send(Ok(Shareable(c)));
        }
    });
    unsafe {
        SCShareableContent::getShareableContentExcludingDesktopWindows_onScreenWindowsOnly_completionHandler(
            false, true, &block,
        );
    }
    rx.recv_timeout(Duration::from_secs(5))
        .map_err(|_| anyhow!("timed out getting shareable content (screen recording permission?)"))?
        .map_err(|e| anyhow!(e))
}

impl Shareable {
    pub fn display(&self, id: u32) -> Option<Retained<SCDisplay>> {
        unsafe { self.0.displays().iter().find(|d| d.displayID() == id) }
    }
    pub fn window(&self, id: u32) -> Option<Retained<SCWindow>> {
        unsafe { self.0.windows().iter().find(|w| w.windowID() == id) }
    }
    pub fn windows_by_ids(&self, ids: &[u32]) -> Vec<Retained<SCWindow>> {
        unsafe { self.0.windows().iter().filter(|w| ids.contains(&w.windowID())).collect() }
    }
}

struct SendImg(Option<objc2_core_foundation::CFRetained<CGImage>>, Option<String>);
unsafe impl Send for SendImg {}

fn screenshot(filter: &SCContentFilter, config: &SCStreamConfiguration) -> Result<RgbaImage> {
    let (tx, rx) = mpsc::channel::<SendImg>();
    let block = RcBlock::new(move |img: *mut CGImage, err: *mut NSError| {
        if img.is_null() {
            let msg = if err.is_null() {
                "capture failed".to_string()
            } else {
                unsafe { (*err).localizedDescription().to_string() }
            };
            let _ = tx.send(SendImg(None, Some(msg)));
        } else {
            let r = unsafe { objc2_core_foundation::CFRetained::retain(std::ptr::NonNull::new_unchecked(img)) };
            let _ = tx.send(SendImg(Some(r), None));
        }
    });
    unsafe {
        SCScreenshotManager::captureImageWithFilter_configuration_completionHandler(filter, config, Some(&block));
    }
    let res = rx.recv_timeout(Duration::from_secs(10)).map_err(|_| anyhow!("capture timed out"))?;
    match res.0 {
        Some(img) => Ok(cgimage_to_rgba(&img)),
        None => Err(anyhow!(res.1.unwrap_or_default())),
    }
}

/// Capture a full display (or `rect` in display-local points), excluding the
/// given window numbers (our own overlays, pins...).
pub fn capture_display(
    content: &Shareable,
    display: &crate::displays::Display,
    exclude: &[u32],
    rect: Option<(f64, f64, f64, f64)>,
    show_cursor: bool,
    scale_override: Option<f64>,
) -> Result<RgbaImage> {
    let sc_display = content.display(display.id).ok_or_else(|| anyhow!("display not found"))?;
    let excluded = content.windows_by_ids(exclude);
    let ex_arr = NSArray::from_retained_slice(&excluded);
    unsafe {
        let filter = SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &sc_display, &ex_arr);
        let config = SCStreamConfiguration::new();
        let scale = scale_override.unwrap_or(display.scale);
        let (x, y, w, h) = rect.unwrap_or((0.0, 0.0, display.width, display.height));
        config.setSourceRect(CGRect::new(CGPoint::new(x, y), CGSize::new(w, h)));
        config.setWidth(((w * scale).round() as usize).max(1));
        config.setHeight(((h * scale).round() as usize).max(1));
        config.setShowsCursor(show_cursor);
        config.setScalesToFit(false);
        config.setIgnoreShadowsDisplay(false);
        screenshot(&filter, &config)
    }
}

/// Capture a single window, optionally including its drop shadow (with a
/// transparent background around it), at the window's native resolution.
pub fn capture_window(content: &Shareable, window_id: u32, shadow: bool, scale: f64) -> Result<RgbaImage> {
    let w = content.window(window_id).ok_or_else(|| anyhow!("window not found"))?;
    unsafe {
        let filter = SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &w);
        let s = {
            let p = filter.pointPixelScale() as f64;
            if p > 0.0 { p } else { scale }
        };
        let frame = w.frame();
        let shoot = |bw: f64, bh: f64| -> Result<RgbaImage> {
            let config = SCStreamConfiguration::new();
            config.setWidth((bw.round() as usize).max(1));
            config.setHeight((bh.round() as usize).max(1));
            config.setShowsCursor(false);
            config.setIgnoreShadowsSingleWindow(!shadow);
            screenshot(&filter, &config)
        };
        let (fw, fh) = (frame.size.width * s, frame.size.height * s);
        let img = shoot(fw, fh)?;
        if !shadow {
            return Ok(img);
        }
        // With the shadow, ScreenCaptureKit fits window+shadow into the
        // buffer. Measure the window inside it and grow the buffer so the
        // window itself is rendered 1:1.
        let (iw, ih) = (img.width(), img.height());
        let (mut x0, mut x1) = (iw, 0);
        let (mut y0, mut y1) = (ih, 0);
        for (x, y, p) in img.enumerate_pixels() {
            if p[3] > 250 {
                x0 = x0.min(x);
                x1 = x1.max(x);
                y0 = y0.min(y);
                y1 = y1.max(y);
            }
        }
        if x1 <= x0 || y1 <= y0 {
            return Ok(img);
        }
        let k = (fw / (x1 - x0 + 1) as f64).max(fh / (y1 - y0 + 1) as f64);
        if k <= 1.01 || k > 3.0 {
            return Ok(img);
        }
        shoot(fw * k, fh * k)
    }
}

/// Convert a CGImage to straight (un-premultiplied) sRGB RGBA8.
pub fn cgimage_to_rgba(img: &CGImage) -> RgbaImage {
    let w = CGImage::width(Some(img));
    let h = CGImage::height(Some(img));
    let mut buf = vec![0u8; w * h * 4];
    unsafe {
        let cs = CGColorSpace::with_name(Some(kCGColorSpaceSRGB));
        // kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big => RGBA in memory
        let ctx = CGBitmapContextCreate(buf.as_mut_ptr() as *mut _, w, h, 8, w * 4, cs.as_deref(), 1 | (4 << 12));
        if let Some(ctx) = ctx {
            CGContext::draw_image(
                Some(&ctx),
                CGRect::new(CGPoint::new(0.0, 0.0), CGSize::new(w as f64, h as f64)),
                Some(img),
            );
        }
    }
    // un-premultiply
    for px in buf.chunks_exact_mut(4) {
        let a = px[3];
        if a != 0 && a != 255 {
            let af = a as f32 / 255.0;
            px[0] = ((px[0] as f32 / af).min(255.0)) as u8;
            px[1] = ((px[1] as f32 / af).min(255.0)) as u8;
            px[2] = ((px[2] as f32 / af).min(255.0)) as u8;
        }
    }
    RgbaImage::from_raw(w as u32, h as u32, buf).unwrap()
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WinInfo {
    pub id: u32,
    pub pid: i32,
    pub owner: String,
    pub title: String,
    pub layer: i64,
    /// CG global points
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub alpha: f64,
}

/// On-screen windows, front to back.
pub fn window_list() -> Vec<WinInfo> {
    let opts = CGWindowListOption::OptionOnScreenOnly | CGWindowListOption::ExcludeDesktopElements;
    let Some(arr) = CGWindowListCopyWindowInfo(opts, 0) else { return vec![] };
    // CFArray<CFDictionary> is toll-free bridged with NSArray<NSDictionary>
    let arr: &NSArray<NSDictionary<NSString, objc2::runtime::AnyObject>> =
        unsafe { &*(objc2_core_foundation::CFRetained::as_ptr(&arr).as_ptr() as *const _) };
    let num = |d: &NSDictionary<NSString, objc2::runtime::AnyObject>, k: &str| -> f64 {
        d.objectForKey(&NSString::from_str(k))
            .and_then(|v| v.downcast::<NSNumber>().ok())
            .map(|n| n.doubleValue())
            .unwrap_or(0.0)
    };
    let s = |d: &NSDictionary<NSString, objc2::runtime::AnyObject>, k: &str| -> String {
        d.objectForKey(&NSString::from_str(k))
            .and_then(|v| v.downcast::<NSString>().ok())
            .map(|n| n.to_string())
            .unwrap_or_default()
    };
    let own_pid = std::process::id() as i32;
    let mut out = vec![];
    for d in arr.iter() {
        let bounds = d
            .objectForKey(&NSString::from_str("kCGWindowBounds"))
            .and_then(|v| v.downcast::<NSDictionary>().ok())
            .map(|d| unsafe { Retained::cast_unchecked::<NSDictionary<NSString, objc2::runtime::AnyObject>>(d) });
        let Some(b) = bounds else { continue };
        let info = WinInfo {
            id: num(&d, "kCGWindowNumber") as u32,
            pid: num(&d, "kCGWindowOwnerPID") as i32,
            owner: s(&d, "kCGWindowOwnerName"),
            title: s(&d, "kCGWindowName"),
            layer: num(&d, "kCGWindowLayer") as i64,
            x: num(&b, "X"),
            y: num(&b, "Y"),
            width: num(&b, "Width"),
            height: num(&b, "Height"),
            alpha: num(&d, "kCGWindowAlpha"),
        };
        if info.pid == own_pid || info.alpha <= 0.01 || info.width < 8.0 || info.height < 8.0 {
            continue;
        }
        out.push(info);
    }
    out
}

/// Windows a user can pick in window-capture mode (normal app windows plus
/// floating panels, menus excluded).
pub fn pickable_windows() -> Vec<WinInfo> {
    let all: Vec<WinInfo> = window_list()
        .into_iter()
        .filter(|w| {
            (0..=8).contains(&w.layer)
                && w.width >= 40.0
                && w.height >= 40.0
                && w.owner != "Window Server"
                && w.owner != "Dock"
                && !(w.owner == "Control Center" || w.owner == "Notification Center")
        })
        .collect();
    // Drop helper windows nested inside a larger window of the same app
    // (tab strips, toolbars...), so hovering picks the real window.
    all.iter()
        .filter(|w| {
            !all.iter().any(|o| {
                o.id != w.id
                    && o.pid == w.pid
                    && o.layer == w.layer
                    && o.width * o.height > w.width * w.height
                    && w.x >= o.x - 1.0
                    && w.y >= o.y - 1.0
                    && w.x + w.width <= o.x + o.width + 1.0
                    && w.y + w.height <= o.y + o.height + 1.0
            })
        })
        .cloned()
        .collect()
}

/// Our own on-screen window numbers.
pub fn own_window_ids() -> Vec<u32> {
    let opts = CGWindowListOption::OptionOnScreenOnly;
    let Some(arr) = CGWindowListCopyWindowInfo(opts, 0) else { return vec![] };
    let arr: &NSArray<NSDictionary<NSString, objc2::runtime::AnyObject>> =
        unsafe { &*(objc2_core_foundation::CFRetained::as_ptr(&arr).as_ptr() as *const _) };
    let own = std::process::id() as f64;
    arr.iter()
        .filter(|d| {
            d.objectForKey(&NSString::from_str("kCGWindowOwnerPID"))
                .and_then(|v| v.downcast::<NSNumber>().ok())
                .map(|n| n.doubleValue() == own)
                .unwrap_or(false)
        })
        .filter_map(|d| {
            d.objectForKey(&NSString::from_str("kCGWindowNumber"))
                .and_then(|v| v.downcast::<NSNumber>().ok())
                .map(|n| n.unsignedIntValue())
        })
        .collect()
}

/// Capture the desktop wallpaper of a display (the Dock/WallpaperAgent
/// "Wallpaper-" window), used for backgrounds and the icon cover.
pub fn capture_wallpaper(content: &Shareable, display: &crate::displays::Display) -> Option<RgbaImage> {
    unsafe {
        let wins = content.0.windows();
        let wp = wins.iter().find(|w| {
            let title = w.title().map(|t| t.to_string()).unwrap_or_default();
            let owner = w
                .owningApplication()
                .map(|a| a.applicationName().to_string())
                .unwrap_or_default();
            let f = w.frame();
            (title.starts_with("Wallpaper") || owner == "Wallpaper" || owner == "WallpaperAgent")
                && (f.origin.x - display.x).abs() < 1.0
                && (f.origin.y - display.y).abs() < 1.0
                && f.size.width >= display.width - 1.0
        })?;
        let filter = SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &wp);
        let config = SCStreamConfiguration::new();
        config.setWidth(display.pixel_width());
        config.setHeight(display.pixel_height());
        config.setShowsCursor(false);
        screenshot(&filter, &config).ok()
    }
}
