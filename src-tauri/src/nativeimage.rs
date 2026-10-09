//! Bridges between RGBA8 buffers and CoreGraphics / ImageIO.

use image::RgbaImage;
use objc2_core_foundation::{CFData, CFDictionary, CFMutableData, CFNumber, CFRetained, CFString, CFURL};
use objc2_core_graphics::{
    kCGColorSpaceSRGB, CGBitmapInfo, CGColorRenderingIntent, CGColorSpace, CGDataProvider, CGImage,
    CGImageAlphaInfo,
};
use objc2_image_io::{kCGImageDestinationLossyCompressionQuality, CGImageDestination, CGImageSource};
use std::path::Path;

pub fn rgba_to_cgimage(img: &RgbaImage) -> Option<CFRetained<CGImage>> {
    // premultiply for CoreGraphics
    let mut buf = img.as_raw().clone();
    for px in buf.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a != 255 {
            px[0] = ((px[0] as u32 * a) / 255) as u8;
            px[1] = ((px[1] as u32 * a) / 255) as u8;
            px[2] = ((px[2] as u32 * a) / 255) as u8;
        }
    }
    let data = CFData::from_buffer(&buf);
    let provider = CGDataProvider::with_cf_data(Some(&data))?;
    let cs = CGColorSpace::with_name(Some(unsafe { kCGColorSpaceSRGB }))?;
    unsafe {
        CGImage::new(
            img.width() as usize,
            img.height() as usize,
            8,
            32,
            img.width() as usize * 4,
            Some(&cs),
            CGBitmapInfo(CGImageAlphaInfo::PremultipliedLast.0 | CGBitmapInfo::ByteOrder32Big.0),
            Some(&provider),
            std::ptr::null(),
            true,
            CGColorRenderingIntent::RenderingIntentDefault,
        )
    }
}

fn encode_with_type(img: &RgbaImage, uti: &str, quality: Option<f64>) -> Option<Vec<u8>> {
    let cg = rgba_to_cgimage(img)?;
    let data = CFMutableData::new(None, 0)?;
    let ty = CFString::from_str(uti);
    unsafe {
        let dest = CGImageDestination::with_data(&data, &ty, 1, None)?;
        let props = quality.map(|q| {
            let key: &CFString = kCGImageDestinationLossyCompressionQuality;
            let val = CFNumber::new_f64(q);
            CFDictionary::<CFString, CFNumber>::from_slices(&[key], &[&*val])
        });
        dest.add_image(&cg, props.as_deref().map(|d| d.as_opaque()));
        if !dest.finalize() {
            return None;
        }
    }
    Some(data.to_vec())
}

pub fn encode_heic(img: &RgbaImage, quality: f64) -> Option<Vec<u8>> {
    encode_with_type(img, "public.heic", Some(quality))
}

pub fn encode_tiff(img: &RgbaImage) -> Option<Vec<u8>> {
    encode_with_type(img, "public.tiff", None)
}

pub fn decode_file(path: &Path) -> Option<RgbaImage> {
    let url = CFURL::from_file_path(path)?;
    unsafe {
        let src = CGImageSource::with_url(&url, None)?;
        let img = src.image_at_index(0, None)?;
        Some(crate::sck::cgimage_to_rgba(&img))
    }
}

pub fn decode_bytes(bytes: &[u8]) -> Option<RgbaImage> {
    if let Ok(i) = image::load_from_memory(bytes) {
        return Some(i.to_rgba8());
    }
    let data = CFData::from_buffer(bytes);
    unsafe {
        let src = CGImageSource::with_data(&data, None)?;
        let img = src.image_at_index(0, None)?;
        Some(crate::sck::cgimage_to_rgba(&img))
    }
}
