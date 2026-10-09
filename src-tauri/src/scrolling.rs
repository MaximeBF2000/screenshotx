//! Scrolling capture: repeatedly capture an area while the user (or the
//! app, with auto-scroll) scrolls, and stitch the frames into one image.
//! Sticky headers/footers are detected and kept once.

use crate::capture::{Context, Rect};
use crate::displays::Display;
use crate::macos;
use crate::sck;
use crate::state::{self, settings};
use crate::windows::{self, PanelKind, Spec};
use anyhow::Result;
use image::RgbaImage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

pub struct ScrollSession {
    stop: Arc<AtomicBool>,
    cancel: Arc<AtomicBool>,
    autoscroll: Arc<AtomicBool>,
}

const PREVIEW_W: f64 = 220.0;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Axis {
    Vertical,
    Horizontal,
}

struct Stitcher {
    axis: Option<Axis>,
    /// accumulated moving region (rows for vertical, columns for horizontal)
    body: Vec<Vec<u8>>,
    header: usize,
    footer: usize,
    first: RgbaImage,
    last: RgbaImage,
    prev: RgbaImage,
}

fn line_hashes(img: &RgbaImage, axis: Axis) -> Vec<u64> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let raw = img.as_raw();
    match axis {
        Axis::Vertical => {
            // ignore 8% on each side (scrollbars, shadows)
            let x0 = w * 8 / 100;
            let x1 = w - x0;
            (0..h)
                .map(|y| {
                    let row = &raw[(y * w + x0) * 4..(y * w + x1) * 4];
                    fx(row)
                })
                .collect()
        }
        Axis::Horizontal => {
            let y0 = h * 8 / 100;
            let y1 = h - y0;
            (0..w)
                .map(|x| {
                    let mut hsh: u64 = 1469598103934665603;
                    for y in y0..y1 {
                        let i = (y * w + x) * 4;
                        for b in &raw[i..i + 3] {
                            hsh = (hsh ^ (*b as u64 >> 2)).wrapping_mul(1099511628211);
                        }
                    }
                    hsh
                })
                .collect()
        }
    }
}

fn fx(bytes: &[u8]) -> u64 {
    // FNV-1a over quantized RGB (tolerates tiny rendering noise)
    let mut h: u64 = 1469598103934665603;
    for px in bytes.chunks_exact(4) {
        for b in &px[..3] {
            h = (h ^ (*b as u64 >> 2)).wrapping_mul(1099511628211);
        }
    }
    h
}

/// Find how far content moved between `a` (previous) and `b` (new).
/// Returns (shift, static_start, static_end) or None.
fn find_shift(a: &[u64], b: &[u64]) -> Option<(usize, usize, usize)> {
    let n = a.len().min(b.len());
    if n < 20 {
        return None;
    }
    let top = a.iter().zip(b).take_while(|(x, y)| x == y).count();
    if top == n {
        return None; // nothing moved
    }
    let bottom = a.iter().rev().zip(b.iter().rev()).take_while(|(x, y)| x == y).count().min(n - top - 1);
    let lo = top;
    let hi = n - bottom;
    let region = hi - lo;
    if region < 16 {
        return None;
    }
    // informative lines: differ from their predecessor (skip flat areas)
    let informative: Vec<usize> = (lo + 1..hi).filter(|&i| b[i] != b[i - 1]).collect();
    if informative.len() < 4 {
        return None;
    }
    let mut best = (0usize, 0usize);
    for s in 1..region {
        let mut m = 0;
        let mut total = 0;
        for &i in &informative {
            if i + s >= hi {
                continue;
            }
            total += 1;
            if b[i] == a[i + s] {
                m += 1;
            }
        }
        if total >= 3 && m * 100 / total >= 70 && m > best.1 {
            best = (s, m);
        }
    }
    (best.1 > 0).then_some((best.0, top, bottom))
}

fn extract_lines(img: &RgbaImage, axis: Axis, from: usize, to: usize) -> Vec<Vec<u8>> {
    let (w, h) = (img.width() as usize, img.height() as usize);
    let raw = img.as_raw();
    match axis {
        Axis::Vertical => (from..to.min(h)).map(|y| raw[y * w * 4..(y + 1) * w * 4].to_vec()).collect(),
        Axis::Horizontal => (from..to.min(w))
            .map(|x| {
                let mut col = Vec::with_capacity(h * 4);
                for y in 0..h {
                    let i = (y * w + x) * 4;
                    col.extend_from_slice(&raw[i..i + 4]);
                }
                col
            })
            .collect(),
    }
}

impl Stitcher {
    fn new(first: RgbaImage) -> Self {
        Self { axis: None, body: vec![], header: 0, footer: 0, prev: first.clone(), last: first.clone(), first }
    }

    /// Feed a new frame; returns true when content was appended.
    fn push(&mut self, frame: RgbaImage) -> bool {
        let axes: Vec<Axis> = match self.axis {
            Some(a) => vec![a],
            None => vec![Axis::Vertical, Axis::Horizontal],
        };
        for axis in axes {
            let a = line_hashes(&self.prev, axis);
            let b = line_hashes(&frame, axis);
            if let Some((shift, top, bottom)) = find_shift(&a, &b) {
                let n = b.len();
                if self.axis.is_none() {
                    self.axis = Some(axis);
                    self.header = top;
                    self.footer = bottom;
                    self.body = extract_lines(&self.first, axis, top, n - bottom);
                }
                let (h0, f0) = (self.header.min(top), self.footer.min(bottom));
                let new_lines = extract_lines(&frame, axis, n - f0 - shift, n - f0);
                self.body.extend(new_lines);
                self.prev = frame.clone();
                self.last = frame;
                self.header = h0;
                self.footer = f0;
                return true;
            }
        }
        false
    }

    fn result(&self) -> RgbaImage {
        let Some(axis) = self.axis else { return self.first.clone() };
        let (w, h) = (self.first.width() as usize, self.first.height() as usize);
        match axis {
            Axis::Vertical => {
                let header = extract_lines(&self.first, axis, 0, self.header);
                let footer = extract_lines(&self.last, axis, h - self.footer, h);
                let total = header.len() + self.body.len() + footer.len();
                let mut raw = Vec::with_capacity(total * w * 4);
                for l in header.iter().chain(self.body.iter()).chain(footer.iter()) {
                    raw.extend_from_slice(l);
                }
                RgbaImage::from_raw(w as u32, total as u32, raw).unwrap_or_else(|| self.first.clone())
            }
            Axis::Horizontal => {
                let header = extract_lines(&self.first, axis, 0, self.header);
                let footer = extract_lines(&self.last, axis, w - self.footer, w);
                let cols: Vec<&Vec<u8>> = header.iter().chain(self.body.iter()).chain(footer.iter()).collect();
                let total_w = cols.len();
                let mut out = RgbaImage::new(total_w as u32, h as u32);
                for (x, col) in cols.iter().enumerate() {
                    for y in 0..h {
                        let p = &col[y * 4..y * 4 + 4];
                        out.put_pixel(x as u32, y as u32, image::Rgba([p[0], p[1], p[2], p[3]]));
                    }
                }
                out
            }
        }
    }
}

static LAST_PREVIEW: parking_lot::Mutex<Option<(String, u32, u32, i64)>> = parking_lot::Mutex::new(None);

pub fn last_preview() -> Option<(String, u32, u32, i64)> {
    LAST_PREVIEW.lock().clone()
}

fn emit_preview(app: &AppHandle, img: &RgbaImage) {
    if let Some(p) = write_preview(img) {
        let payload = (p, img.width(), img.height(), state::now_ms());
        *LAST_PREVIEW.lock() = Some(payload.clone());
        let _ = app.emit_to("scrollprev", "scroll:preview", payload);
    }
}

fn preview_path() -> std::path::PathBuf {
    crate::paths::temp_dir().join("scroll-preview.jpg")
}

fn write_preview(img: &RgbaImage) -> Option<String> {
    let r = PREVIEW_W * 2.0 / img.width() as f64;
    let h = ((img.height() as f64 * r) as u32).clamp(1, 12000);
    let small = image::imageops::resize(img, (PREVIEW_W * 2.0) as u32, h, image::imageops::FilterType::Triangle);
    let bytes = crate::imageops::encode_jpeg(&small, 80).ok()?;
    let p = preview_path();
    std::fs::write(&p, bytes).ok()?;
    Some(p.to_string_lossy().to_string())
}

fn scroll_event(dx: i32, dy: i32) {
    use objc2_core_graphics::{CGEvent, CGEventTapLocation, CGScrollEventUnit};
    unsafe {
        if let Some(ev) = CGEvent::new_scroll_wheel_event2(None, CGScrollEventUnit::Pixel, 2, dy, dx, 0) {
            CGEvent::post(CGEventTapLocation::HIDEventTap, Some(&ev));
        }
    }
}

fn warp_mouse(x: f64, y: f64) {
    let _ = objc2_core_graphics::CGWarpMouseCursorPosition(objc2_core_foundation::CGPoint::new(x, y));
}

fn ui_windows(app: &AppHandle, d: &Display, r: Rect) {
    // frame around the area
    let label = format!("recframe-{}", d.id);
    windows::close(app, &label);
    let mut spec = Spec::new(&label, "recframe");
    spec.query = vec![("x", r.x.to_string()), ("y", r.y.to_string()), ("w", r.w.to_string()), ("h", r.h.to_string()), ("dim", "true".into())];
    spec.width = d.width;
    spec.height = d.height;
    spec.pos = Some((d.x, d.y));
    spec.panel = Some(PanelKind::Passive);
    spec.level = macos::Level::Floating;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    spec.click_through = true;
    let _ = windows::create(app, spec);

    // preview panel beside the area
    let pw = PREVIEW_W + 28.0;
    let ph = (r.h + 60.0).clamp(300.0, d.height - 40.0);
    let right_space = d.width - (r.x + r.w);
    let x = if right_space > pw + 24.0 { d.x + r.x + r.w + 16.0 } else if r.x > pw + 24.0 { d.x + r.x - pw - 16.0 } else { d.x + d.width - pw - 16.0 };
    let y = (d.y + r.y).clamp(d.y + 30.0, d.y + d.height - ph - 10.0);
    windows::close(app, "scrollprev");
    let mut spec = Spec::new("scrollprev", "scrollprev");
    spec.query = vec![("auto", state::state().scrolling.lock().as_ref().map(|s| s.autoscroll.load(Ordering::SeqCst)).unwrap_or(false).to_string())];
    spec.width = pw;
    spec.height = ph;
    spec.pos = Some((x, y));
    spec.panel = Some(PanelKind::Key);
    spec.level = macos::Level::Overlay;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    let _ = windows::create(app, spec);
    windows::make_key(app, "scrollprev");
}

pub fn begin(app: &AppHandle, d: Display, r: Rect, autoscroll: bool, ctx: Context, hid_icons: bool) -> Result<()> {
    *LAST_PREVIEW.lock() = None;
    if autoscroll && !macos::has_accessibility_permission(false) {
        crate::permissions::prompt_accessibility(app, "auto-scroll");
    }
    let stop = Arc::new(AtomicBool::new(false));
    let cancel = Arc::new(AtomicBool::new(false));
    let auto = Arc::new(AtomicBool::new(autoscroll));
    *state::state().scrolling.lock() = Some(ScrollSession { stop: stop.clone(), cancel: cancel.clone(), autoscroll: auto.clone() });
    ui_windows(app, &d, r);
    crate::hotkeys::session_keys(app, "scroll", &["Escape", "Enter"]);
    crate::tray::refresh(app);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(Duration::from_millis(250));
        let content = match sck::shareable_content() {
            Ok(c) => c,
            Err(e) => {
                crate::toast::show(&app, "error", "Scrolling capture failed", &e.to_string());
                return finish_cleanup(&app, hid_icons);
            }
        };
        let s = settings();
        let grab = |app: &AppHandle| -> Option<RgbaImage> {
            let exclude = windows::excluded_window_numbers(app, s.pins_show_on_screenshots);
            sck::capture_display(&content, &d, &exclude, Some((r.x, r.y, r.w, r.h)), false, None).ok()
        };
        let Some(first) = grab(&app) else {
            crate::toast::show(&app, "error", "Scrolling capture failed", "Could not capture the screen.");
            return finish_cleanup(&app, hid_icons);
        };
        let mut st = Stitcher::new(first);
        emit_preview(&app, &st.first);
        let mut last_change = Instant::now();
        let mut auto_started = false;
        while !stop.load(Ordering::SeqCst) && !cancel.load(Ordering::SeqCst) {
            if auto.load(Ordering::SeqCst) {
                if !auto_started {
                    warp_mouse(d.x + r.x + r.w / 2.0, d.y + r.y + r.h / 2.0);
                    auto_started = true;
                    last_change = Instant::now();
                }
                let step = (r.h * 0.35) as i32;
                if st.axis == Some(Axis::Horizontal) {
                    scroll_event(-step, 0);
                } else {
                    scroll_event(0, -step);
                }
                std::thread::sleep(Duration::from_millis(220));
            } else {
                std::thread::sleep(Duration::from_millis(110));
            }
            let Some(frame) = grab(&app) else { continue };
            if st.push(frame) {
                last_change = Instant::now();
                let res = st.result();
                emit_preview(&app, &res);
                // safety limit (~ 30 000 px)
                if res.height() > 30_000 || res.width() > 30_000 {
                    break;
                }
            } else if auto.load(Ordering::SeqCst) && last_change.elapsed() > Duration::from_millis(1600) {
                // reached the end of the page
                break;
            }
        }
        let cancelled = cancel.load(Ordering::SeqCst);
        finish_cleanup(&app, hid_icons);
        if !cancelled {
            let img = st.result();
            crate::output::finish_screenshot(&app, img, d.scale, ctx);
        }
    });
    Ok(())
}

fn finish_cleanup(app: &AppHandle, hid_icons: bool) {
    crate::hotkeys::end_session_keys(app, "scroll");
    *state::state().scrolling.lock() = None;
    let labels: Vec<String> = app.webview_windows().keys().filter(|l| l.starts_with("recframe-") || *l == "scrollprev").cloned().collect();
    for l in labels {
        windows::close(app, &l);
    }
    if hid_icons {
        crate::desktop::set_hidden(app, false);
    }
    crate::tray::refresh(app);
}

pub fn finish(_app: &AppHandle) {
    if let Some(s) = state::state().scrolling.lock().as_ref() {
        s.stop.store(true, Ordering::SeqCst);
    }
}

pub fn cancel(_app: &AppHandle) {
    if let Some(s) = state::state().scrolling.lock().as_ref() {
        s.cancel.store(true, Ordering::SeqCst);
    }
}

pub fn set_autoscroll(on: bool) {
    if let Some(s) = state::state().scrolling.lock().as_ref() {
        s.autoscroll.store(on, Ordering::SeqCst);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(h: u32, offset: u32, view: u32) -> RgbaImage {
        // synthetic "page": every row has a distinct pattern
        let mut img = RgbaImage::new(200, view);
        for y in 0..view {
            let py = y + offset;
            for x in 0..200 {
                let v = ((py * 37 + x * (py % 7 + 1)) % 251) as u8;
                img.put_pixel(x, y, image::Rgba([v, v.wrapping_mul(3), (py % 255) as u8, 255]));
            }
        }
        let _ = h;
        img
    }

    #[test]
    fn stitches_vertical_scroll() {
        let mut st = Stitcher::new(page(2000, 0, 300));
        assert!(st.push(page(2000, 120, 300)));
        assert!(st.push(page(2000, 260, 300)));
        let res = st.result();
        assert_eq!(res.height(), 560);
        assert_eq!(res.get_pixel(10, 400), page(2000, 0, 600).get_pixel(10, 400));
    }

    #[test]
    fn ignores_no_movement() {
        let mut st = Stitcher::new(page(2000, 0, 300));
        assert!(!st.push(page(2000, 0, 300)));
        assert_eq!(st.result().height(), 300);
    }
}
