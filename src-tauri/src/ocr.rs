//! Text recognition + QR / barcode reading.
//!
//! The text engine is pluggable (Settings → Screenshots → Text recognition):
//! Apple Vision on device, or a model served by a local Ollama (GLM-OCR by
//! default). To add one, implement [`Engine`] and return it from [`engine`].
//! Barcodes are always read with Vision.

use crate::settings::Settings;
use crate::state::settings;
use crate::toast::{self, Toast, ToastAction};
use image::RgbaImage;
use objc2::rc::Retained;
use objc2::AnyThread;
use objc2_foundation::{NSArray, NSDictionary, NSString};
use objc2_vision::{
    VNDetectBarcodesRequest, VNImageRequestHandler, VNRecognizeTextRequest, VNRequest, VNRequestTextRecognitionLevel,
};
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
pub struct Line {
    pub text: String,
    /// normalized, origin top-left
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

#[derive(Debug, Default, Clone, Serialize)]
pub struct OcrResult {
    pub lines: Vec<Line>,
    pub codes: Vec<String>,
}

pub fn supported_languages() -> Vec<String> {
    unsafe {
        let req = VNRecognizeTextRequest::new();
        req.setRecognitionLevel(VNRequestTextRecognitionLevel::Accurate);
        req.supportedRecognitionLanguagesAndReturnError()
            .map(|a| a.iter().map(|s| s.to_string()).collect())
            .unwrap_or_default()
    }
}

static ACCURATE_STALLS: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Accurate recognition, falling back to the fast recognizer when the
/// accurate model stalls (seen on some systems while its Neural Engine model
/// is being prepared).
pub fn recognize(img: &RgbaImage, language: &str) -> OcrResult {
    use std::sync::atomic::Ordering;
    if !ACCURATE_STALLS.load(Ordering::SeqCst) {
        let (tx, rx) = std::sync::mpsc::channel();
        let img2 = img.clone();
        let lang = language.to_string();
        std::thread::spawn(move || {
            let _ = tx.send(recognize_level(&img2, &lang, VNRequestTextRecognitionLevel::Accurate));
        });
        match rx.recv_timeout(std::time::Duration::from_secs(6)) {
            Ok(r) => return r,
            Err(_) => {
                log::warn!("accurate OCR stalled, using the fast recognizer");
                ACCURATE_STALLS.store(true, Ordering::SeqCst);
            }
        }
    }
    recognize_level(img, language, VNRequestTextRecognitionLevel::Fast)
}

/// A text recognizer.
pub trait Engine {
    /// Shown in logs and in the fallback message.
    fn name(&self) -> &'static str;
    /// The text in `img`, lines separated by `\n` when `keep_line_breaks`.
    fn text(&self, img: &RgbaImage, keep_line_breaks: bool) -> anyhow::Result<String>;
}

pub struct Vision {
    pub language: String,
}

impl Engine for Vision {
    fn name(&self) -> &'static str {
        "Apple Vision"
    }
    fn text(&self, img: &RgbaImage, keep_line_breaks: bool) -> anyhow::Result<String> {
        Ok(join(&recognize(img, &self.language).lines, keep_line_breaks))
    }
}

pub struct Ollama {
    pub url: String,
    pub model: String,
    pub prompt: String,
}

impl Engine for Ollama {
    fn name(&self) -> &'static str {
        "Ollama"
    }
    fn text(&self, img: &RgbaImage, keep_line_breaks: bool) -> anyhow::Result<String> {
        let text = crate::ocr_ollama::recognize(&self.url, &self.model, &self.prompt, img)?;
        Ok(if keep_line_breaks { text } else { text.split_whitespace().collect::<Vec<_>>().join(" ") })
    }
}

/// The engine picked in Settings.
pub fn engine(s: &Settings) -> Box<dyn Engine> {
    match s.ocr_engine.as_str() {
        "ollama" => Box::new(Ollama { url: s.ocr_ollama_url.clone(), model: s.ocr_ollama_model.clone(), prompt: s.ocr_ollama_prompt.clone() }),
        _ => Box::new(Vision { language: s.ocr_language.clone() }),
    }
}

/// QR codes and barcodes only.
pub fn detect_codes(img: &RgbaImage) -> Vec<String> {
    recognize_with(img, "", VNRequestTextRecognitionLevel::Fast, false).codes
}

fn recognize_level(img: &RgbaImage, language: &str, level: VNRequestTextRecognitionLevel) -> OcrResult {
    recognize_with(img, language, level, true)
}

fn recognize_with(img: &RgbaImage, language: &str, level: VNRequestTextRecognitionLevel, with_text: bool) -> OcrResult {
    let Some(cg) = crate::nativeimage::rgba_to_cgimage(img) else { return OcrResult::default() };
    unsafe {
        let handler = VNImageRequestHandler::initWithCGImage_options(VNImageRequestHandler::alloc(), &cg, &NSDictionary::new());
        let text = VNRecognizeTextRequest::new();
        text.setRecognitionLevel(level);
        text.setUsesLanguageCorrection(true);
        if language.is_empty() || language == "auto" {
            text.setAutomaticallyDetectsLanguage(true);
        } else {
            let langs = NSArray::from_retained_slice(&[NSString::from_str(language)]);
            text.setRecognitionLanguages(&langs);
        }
        let codes = VNDetectBarcodesRequest::new();
        let mut reqs: Vec<Retained<VNRequest>> = vec![Retained::into_super(Retained::into_super(codes.clone()))];
        if with_text {
            reqs.push(Retained::into_super(Retained::into_super(text.clone())));
        }
        let arr = NSArray::from_retained_slice(&reqs);
        if handler.performRequests_error(&arr).is_err() {
            return OcrResult::default();
        }
        let mut out = OcrResult::default();
        if let Some(results) = text.results().filter(|_| with_text) {
            for obs in results.iter() {
                let cands = obs.topCandidates(1);
                if let Some(c) = cands.firstObject() {
                    let bb = obs.boundingBox();
                    out.lines.push(Line {
                        text: c.string().to_string(),
                        x: bb.origin.x,
                        y: 1.0 - bb.origin.y - bb.size.height,
                        w: bb.size.width,
                        h: bb.size.height,
                    });
                }
            }
        }
        if let Some(results) = codes.results() {
            for obs in results.iter() {
                if let Some(p) = obs.payloadStringValue() {
                    out.codes.push(p.to_string());
                }
            }
        }
        out
    }
}

/// Join recognized lines in reading order; paragraphs are separated when the
/// vertical gap is larger than a line.
pub fn join(lines: &[Line], keep_line_breaks: bool) -> String {
    let mut ls = lines.to_vec();
    ls.sort_by(|a, b| {
        let same_row = (a.y - b.y).abs() < a.h.min(b.h) * 0.5;
        if same_row {
            a.x.partial_cmp(&b.x).unwrap()
        } else {
            a.y.partial_cmp(&b.y).unwrap()
        }
    });
    let mut out = String::new();
    let mut prev: Option<&Line> = None;
    for l in &ls {
        if let Some(p) = prev {
            let same_row = (l.y - p.y).abs() < l.h.min(p.h) * 0.5;
            if same_row {
                out.push_str("  ");
            } else if keep_line_breaks {
                let gap = l.y - (p.y + p.h);
                out.push('\n');
                if gap > p.h * 0.9 {
                    out.push('\n');
                }
            } else {
                out.push(' ');
            }
        }
        out.push_str(l.text.trim_end());
        prev = Some(l);
    }
    out
}

fn find_url(text: &str) -> Option<String> {
    text.split_whitespace()
        .map(|w| w.trim_matches(|c: char| c == '(' || c == ')' || c == ',' || c == '"' || c == '\''))
        .find(|w| {
            (w.starts_with("http://") || w.starts_with("https://") || w.starts_with("www."))
                && w.len() > 8
                && url::Url::parse(&if w.starts_with("www.") { format!("https://{w}") } else { w.to_string() }).is_ok()
        })
        .map(|w| if w.starts_with("www.") { format!("https://{w}") } else { w.to_string() })
}

/// Recognize, copy to the clipboard and tell the user.
pub fn run_and_copy(app: &AppHandle, img: &RgbaImage, keep_line_breaks: bool) {
    let s = settings();
    let t = std::time::Instant::now();
    let eng = engine(&s);
    if s.ocr_engine == "ollama" {
        toast::show(app, "ocr", "Recognizing text…", "");
    }
    let mut fallback = None;
    let mut text = match eng.text(img, keep_line_breaks) {
        Ok(t) => t,
        Err(e) => {
            // e.g. Ollama not running or the model not downloaded
            log::warn!("ocr: {} failed ({e:#}), using Apple Vision", eng.name());
            fallback = Some(format!("{e}"));
            Vision { language: s.ocr_language.clone() }.text(img, keep_line_breaks).unwrap_or_default()
        }
    };
    let codes = detect_codes(img);
    log::info!("ocr ({}): {} chars, {} codes in {:?}", eng.name(), text.len(), codes.len(), t.elapsed());
    let res = OcrResult { lines: vec![], codes };
    if text.trim().is_empty() && !res.codes.is_empty() {
        text = res.codes.join("\n");
    } else if !res.codes.is_empty() {
        text = format!("{}\n{}", res.codes.join("\n"), text);
    }
    if text.trim().is_empty() {
        crate::macos::play_sound(app, "error");
        toast::show(app, "ocr", "No text detected", "Try selecting a larger area.");
        return;
    }
    crate::clipboard::copy_text(&text);
    if s.play_sounds {
        crate::macos::play_sound(app, "ocr");
    }
    let preview: String = match &fallback {
        // say why the configured engine wasn't used
        Some(why) => format!("Used Apple Vision: {why}"),
        None => text.chars().take(140).collect(),
    };
    let url = if s.ocr_detect_links { find_url(&text) } else { None };
    match url {
        Some(u) if s.ocr_open_links == "always" => {
            crate::macos::open_url(&u);
            toast::show(app, "ocr", "Text has been copied", &preview);
        }
        Some(u) if s.ocr_open_links != "never" => {
            toast::present(
                app,
                Toast {
                    id: crate::state::new_id(),
                    kind: "link".into(),
                    title: if res.codes.iter().any(|c| c == &u) { "QR code detected".into() } else { "Text has been copied".into() },
                    body: u.clone(),
                    actions: vec![
                        ToastAction { id: format!("open-url:{u}"), label: "Open Link in Browser".into() },
                        ToastAction { id: "never-open-links".into(), label: "Never open links".into() },
                    ],
                    duration_ms: 6000,
                },
            );
        }
        _ => toast::show(app, "ocr", "Text has been copied", &preview),
    }
}

/// OCR an image file (URL scheme `capture-text?filepath=`).
pub fn run_on_file(app: &AppHandle, path: &str, keep_line_breaks: bool) {
    match crate::imageops::load(std::path::Path::new(path)) {
        Ok(img) => run_and_copy(app, &img, keep_line_breaks),
        Err(e) => toast::show(app, "error", "Could not open image", &e.to_string()),
    }
}
