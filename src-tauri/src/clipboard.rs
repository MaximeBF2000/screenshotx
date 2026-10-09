//! NSPasteboard access. Images are written as PNG + TIFF (TIFF keeps older
//! apps happy), files as file URLs, so pasting works in Finder, chat apps and
//! image editors alike.

use image::RgbaImage;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::AnyThread;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardWriting};
use objc2_foundation::{NSArray, NSData, NSString, NSURL};
use std::path::Path;

use crate::settings::ClipboardContent;

fn general() -> Retained<NSPasteboard> {
    NSPasteboard::generalPasteboard()
}

pub fn copy_text(text: &str) {
    let pb = general();
    pb.clearContents();
    unsafe {
        pb.setString_forType(&NSString::from_str(text), &NSString::from_str("public.utf8-plain-text"));
    }
}

/// Copy a capture: image data and/or the file reference.
pub fn copy_capture(path: &Path, img: Option<&RgbaImage>, mode: &ClipboardContent) {
    let pb = general();
    pb.clearContents();
    let item = NSPasteboardItem::init(NSPasteboardItem::alloc());
    let is_image = matches!(
        path.extension().and_then(|e| e.to_str()).map(|s| s.to_lowercase()).as_deref(),
        Some("png" | "jpg" | "jpeg" | "heic" | "webp" | "tiff" | "gif")
    );
    let want_image = is_image && !matches!(mode, ClipboardContent::FileOnly);
    let want_file = !matches!(mode, ClipboardContent::ImageOnly) || !is_image;
    unsafe {
        if want_image {
            let ext = path.extension().and_then(|e| e.to_str()).unwrap_or("").to_lowercase();
            let bytes = std::fs::read(path).unwrap_or_default();
            if ext == "png" {
                item.setData_forType(&NSData::with_bytes(&bytes), &NSString::from_str("public.png"));
            } else if ext == "gif" {
                item.setData_forType(&NSData::with_bytes(&bytes), &NSString::from_str("com.compuserve.gif"));
            }
            let decoded;
            let img = match img {
                Some(i) => Some(i),
                None => {
                    decoded = crate::imageops::load(path).ok();
                    decoded.as_ref()
                }
            };
            if let Some(img) = img {
                if ext != "png" {
                    if let Ok(png) = crate::imageops::encode_png(img, 1.0) {
                        item.setData_forType(&NSData::with_bytes(&png), &NSString::from_str("public.png"));
                    }
                }
                if let Some(tiff) = crate::nativeimage::encode_tiff(img) {
                    item.setData_forType(&NSData::with_bytes(&tiff), &NSString::from_str("public.tiff"));
                }
            }
        }
        if want_file {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
            if let Some(s) = url.absoluteString() {
                item.setString_forType(&s, &NSString::from_str("public.file-url"));
            }
            item.setString_forType(
                &NSString::from_str(&path.file_name().map(|f| f.to_string_lossy().to_string()).unwrap_or_default()),
                &NSString::from_str("public.utf8-plain-text"),
            );
        }
        let obj: Retained<ProtocolObject<dyn NSPasteboardWriting>> = ProtocolObject::from_retained(item);
        pb.writeObjects(&NSArray::from_retained_slice(&[obj]));
    }
}

/// Copy multiple files (e.g. "Copy" with several selected history items).
pub fn copy_files(paths: &[String]) {
    let pb = general();
    pb.clearContents();
    let objs: Vec<Retained<ProtocolObject<dyn NSPasteboardWriting>>> = paths
        .iter()
        .map(|p| ProtocolObject::from_retained(NSURL::fileURLWithPath(&NSString::from_str(p))))
        .collect();
    pb.writeObjects(&NSArray::from_retained_slice(&objs));
}

/// Image currently on the clipboard (image data or an image file).
pub fn read_image() -> Option<RgbaImage> {
    let pb = general();
    unsafe {
        for ty in ["public.png", "public.tiff", "public.jpeg", "public.heic"] {
            if let Some(data) = pb.dataForType(&NSString::from_str(ty)) {
                let bytes = data.to_vec();
                if let Some(img) = crate::nativeimage::decode_bytes(&bytes) {
                    return Some(img);
                }
            }
        }
        if let Some(s) = pb.stringForType(&NSString::from_str("public.file-url")) {
            if let Some(url) = NSURL::URLWithString(&s) {
                if let Some(p) = url.path() {
                    return crate::imageops::load(Path::new(&p.to_string())).ok();
                }
            }
        }
    }
    None
}

pub fn read_text() -> Option<String> {
    let pb = general();
    unsafe { pb.stringForType(&NSString::from_str("public.utf8-plain-text")).map(|s| s.to_string()) }
}
