//! Image encoding / compositing helpers (pure Rust, operate on RGBA8).

use anyhow::Result;
use image::{imageops, Rgba, RgbaImage};
use std::io::Write;
use std::path::Path;

/// Encode PNG quickly, tagging Retina images with 144 DPI so Preview and
/// other apps display them at their point size (like macOS does).
pub fn encode_png(img: &RgbaImage, scale: f64) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity((img.width() * img.height()) as usize);
    {
        let mut enc = png::Encoder::new(&mut out, img.width(), img.height());
        enc.set_color(png::ColorType::Rgba);
        enc.set_depth(png::BitDepth::Eight);
        enc.set_compression(png::Compression::Fast);
        enc.set_filter(png::FilterType::Paeth);
        enc.set_source_srgb(png::SrgbRenderingIntent::Perceptual);
        let ppm = (scale.max(1.0) * 72.0 / 0.0254).round() as u32;
        enc.set_pixel_dims(Some(png::PixelDimensions { xppu: ppm, yppu: ppm, unit: png::Unit::Meter }));
        let opaque = img.pixels().all(|p| p[3] == 255);
        if opaque {
            enc.set_color(png::ColorType::Rgb);
            let mut w = enc.write_header()?;
            let rgb: Vec<u8> = img.pixels().flat_map(|p| [p[0], p[1], p[2]]).collect();
            w.write_image_data(&rgb)?;
        } else {
            let mut w = enc.write_header()?;
            w.write_image_data(img.as_raw())?;
        }
    }
    Ok(out)
}

pub fn encode_jpeg(img: &RgbaImage, quality: u8) -> Result<Vec<u8>> {
    let rgb = image::DynamicImage::ImageRgba8(img.clone()).to_rgb8();
    let mut out = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut out, quality.clamp(10, 100));
    enc.encode_image(&rgb)?;
    Ok(out)
}

/// Encode in the user's preferred format. Returns (bytes, extension).
pub fn encode(img: &RgbaImage, format: &str, quality: u32, scale: f64) -> Result<(Vec<u8>, &'static str)> {
    match format {
        "jpg" | "jpeg" => Ok((encode_jpeg(img, quality as u8)?, "jpg")),
        "heic" => match crate::nativeimage::encode_heic(img, quality as f64 / 100.0) {
            Some(b) => Ok((b, "heic")),
            None => Ok((encode_png(img, scale)?, "png")),
        },
        "webp" => {
            let mut out = Vec::new();
            image::codecs::webp::WebPEncoder::new_lossless(&mut out).encode(
                img.as_raw(),
                img.width(),
                img.height(),
                image::ExtendedColorType::Rgba8,
            )?;
            Ok((out, "webp"))
        }
        _ => Ok((encode_png(img, scale)?, "png")),
    }
}

pub fn write_file(path: &Path, bytes: &[u8]) -> Result<()> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let mut f = std::fs::File::create(path)?;
    f.write_all(bytes)?;
    Ok(())
}

pub fn crop(img: &RgbaImage, x: u32, y: u32, w: u32, h: u32) -> RgbaImage {
    let x = x.min(img.width().saturating_sub(1));
    let y = y.min(img.height().saturating_sub(1));
    let w = w.min(img.width() - x).max(1);
    let h = h.min(img.height() - y).max(1);
    imageops::crop_imm(img, x, y, w, h).to_image()
}

pub fn scale_to(img: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    imageops::resize(img, w.max(1), h.max(1), imageops::FilterType::Lanczos3)
}

pub fn thumbnail(img: &RgbaImage, max: u32) -> RgbaImage {
    let (w, h) = (img.width(), img.height());
    if w <= max && h <= max {
        return img.clone();
    }
    let r = (max as f64 / w as f64).min(max as f64 / h as f64);
    imageops::thumbnail(img, ((w as f64 * r) as u32).max(1), ((h as f64 * r) as u32).max(1))
}

pub fn add_border(img: &RgbaImage, color: [u8; 4]) -> RgbaImage {
    let mut out = RgbaImage::from_pixel(img.width() + 2, img.height() + 2, Rgba(color));
    imageops::overlay(&mut out, img, 1, 1);
    out
}

pub fn parse_hex(s: &str) -> [u8; 4] {
    let s = s.trim_start_matches('#');
    let p = |i: usize| u8::from_str_radix(s.get(i..i + 2).unwrap_or("00"), 16).unwrap_or(0);
    if s.len() >= 8 {
        [p(0), p(2), p(4), p(6)]
    } else {
        [p(0), p(2), p(4), 255]
    }
}

/// Composite a (transparent, shadowed) window capture onto a background
/// image or color with uniform padding.
pub fn window_on_background(win: &RgbaImage, bg: Option<&RgbaImage>, color: [u8; 4], padding: u32) -> RgbaImage {
    let w = win.width() + padding * 2;
    let h = win.height() + padding * 2;
    let mut out = match bg {
        Some(b) => cover(b, w, h),
        None => RgbaImage::from_pixel(w, h, Rgba(color)),
    };
    imageops::overlay(&mut out, win, padding as i64, padding as i64);
    out
}

/// Scale + center-crop an image so it covers w×h.
pub fn cover(src: &RgbaImage, w: u32, h: u32) -> RgbaImage {
    let r = (w as f64 / src.width() as f64).max(h as f64 / src.height() as f64);
    let sw = ((src.width() as f64 * r).ceil() as u32).max(w);
    let sh = ((src.height() as f64 * r).ceil() as u32).max(h);
    let scaled = imageops::resize(src, sw, sh, imageops::FilterType::Triangle);
    imageops::crop_imm(&scaled, (sw - w) / 2, (sh - h) / 2, w, h).to_image()
}

/// Fast uncompressed BMP (top-down BGRA) used to ship frozen-screen
/// snapshots to the overlay webview without paying for PNG encoding.
pub fn encode_bmp(img: &RgbaImage) -> Vec<u8> {
    let (w, h) = (img.width(), img.height());
    let data_len = (w * h * 4) as usize;
    let header_len = 14 + 40;
    let mut out = Vec::with_capacity(header_len + data_len);
    out.extend_from_slice(b"BM");
    out.extend_from_slice(&((header_len + data_len) as u32).to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&(header_len as u32).to_le_bytes());
    out.extend_from_slice(&40u32.to_le_bytes());
    out.extend_from_slice(&(w as i32).to_le_bytes());
    out.extend_from_slice(&(-(h as i32)).to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&32u16.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes()); // BI_RGB
    out.extend_from_slice(&(data_len as u32).to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&2835i32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.extend_from_slice(&0u32.to_le_bytes());
    out.resize(header_len + data_len, 0);
    let dst = &mut out[header_len..];
    for (d, s) in dst.chunks_exact_mut(4).zip(img.as_raw().chunks_exact(4)) {
        d[0] = s[2];
        d[1] = s[1];
        d[2] = s[0];
        d[3] = 255;
    }
    out
}

pub fn load(path: &Path) -> Result<RgbaImage> {
    if let Ok(img) = image::open(path) {
        return Ok(img.to_rgba8());
    }
    // HEIC/TIFF/PDF etc. via ImageIO
    crate::nativeimage::decode_file(path).ok_or_else(|| anyhow::anyhow!("unsupported image"))
}

/// Read the 144-DPI hint from a PNG to recover the capture scale.
pub fn png_scale(path: &Path) -> f64 {
    let Ok(f) = std::fs::File::open(path) else { return 1.0 };
    let dec = png::Decoder::new(std::io::BufReader::new(f));
    if let Ok(reader) = dec.read_info() {
        if let Some(d) = reader.info().pixel_dims {
            if d.unit == png::Unit::Meter && d.xppu > 0 {
                let dpi = d.xppu as f64 * 0.0254;
                return (dpi / 72.0).round().max(1.0);
            }
        }
    }
    1.0
}
