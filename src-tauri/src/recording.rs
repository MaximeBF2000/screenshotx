//! Screen recording with ScreenCaptureKit (`SCStream` + `SCRecordingOutput`).
//! Pausing finalizes the current segment; segments are joined at the end.

use crate::capture::Rect;
use crate::displays::Display;
use crate::macos::{self, SendPtr};
use crate::sck;
use crate::state::{self, settings, CaptureKind};
use crate::windows::{self, PanelKind, Spec};
use anyhow::{anyhow, Result};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{define_class, msg_send, AnyThread, DefinedClass};
use objc2_av_foundation::{AVCaptureDevice, AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVVideoCodecTypeH264, AVVideoCodecTypeHEVC};
use objc2_core_foundation::{CGPoint, CGRect, CGSize};
use objc2_core_media::CMTime;
use objc2_foundation::{NSArray, NSError, NSObject, NSObjectProtocol, NSString, NSURL};
use objc2_screen_capture_kit::{
    SCContentFilter, SCRecordingOutput, SCRecordingOutputConfiguration, SCRecordingOutputDelegate, SCStream,
    SCStreamConfiguration, SCStreamDelegate,
};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager};

// ------------------------------------------------------------ delegates

pub struct DelegateIvars {
    finished: parking_lot::Mutex<Option<mpsc::Sender<Result<(), String>>>>,
    started: AtomicBool,
}

define_class!(
    #[unsafe(super(NSObject))]
    #[name = "SXRecordingDelegate"]
    #[ivars = DelegateIvars]
    pub struct RecDelegate;

    unsafe impl NSObjectProtocol for RecDelegate {}

    unsafe impl SCRecordingOutputDelegate for RecDelegate {
        #[unsafe(method(recordingOutputDidStartRecording:))]
        fn did_start(&self, _o: &SCRecordingOutput) {
            self.ivars().started.store(true, Ordering::SeqCst);
            log::info!("recording output started");
        }

        #[unsafe(method(recordingOutput:didFailWithError:))]
        fn did_fail(&self, _o: &SCRecordingOutput, err: &NSError) {
            let msg = err.localizedDescription().to_string();
            log::error!("recording output failed: {msg}");
            if let Some(tx) = self.ivars().finished.lock().take() {
                let _ = tx.send(Err(msg));
            }
        }

        #[unsafe(method(recordingOutputDidFinishRecording:))]
        fn did_finish(&self, _o: &SCRecordingOutput) {
            log::info!("recording output finished");
            if let Some(tx) = self.ivars().finished.lock().take() {
                let _ = tx.send(Ok(()));
            }
        }
    }

    unsafe impl SCStreamDelegate for RecDelegate {
        #[unsafe(method(stream:didStopWithError:))]
        fn did_stop(&self, _s: &SCStream, err: &NSError) {
            let msg = err.localizedDescription().to_string();
            log::error!("stream stopped with error: {msg}");
            let app = state::app().clone();
            std::thread::spawn(move || {
                crate::toast::show(&app, "error", "Screen Recording stopped unexpectedly.", &msg);
                stop(&app);
            });
        }
    }
);

impl RecDelegate {
    fn new(tx: mpsc::Sender<Result<(), String>>) -> Retained<Self> {
        let this = Self::alloc().set_ivars(DelegateIvars { finished: parking_lot::Mutex::new(Some(tx)), started: AtomicBool::new(false) });
        unsafe { msg_send![super(this), init] }
    }
}

// ------------------------------------------------------------ state

struct Segment {
    stream: SendPtr<Retained<SCStream>>,
    _output: SendPtr<Retained<SCRecordingOutput>>,
    _delegate: SendPtr<Retained<RecDelegate>>,
    finished: mpsc::Receiver<Result<(), String>>,
    path: PathBuf,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecInfo {
    pub kind: String,
    pub paused: bool,
    pub elapsed: f64,
    pub mic: bool,
    pub camera: bool,
}

pub struct Recording {
    pub kind: String,
    pub display: Display,
    pub rect: Rect,
    pub window_id: Option<u32>,
    started: Instant,
    paused_total: Duration,
    paused_at: Option<Instant>,
    segments: Vec<PathBuf>,
    current: Option<Segment>,
    hid_icons: bool,
    dnd: bool,
    mic: bool,
    camera: bool,
    app_name: String,
}

impl Recording {
    fn elapsed(&self) -> f64 {
        let mut d = self.started.elapsed() - self.paused_total;
        if let Some(p) = self.paused_at {
            d -= p.elapsed();
        }
        d.as_secs_f64()
    }
    fn info(&self) -> RecInfo {
        RecInfo { kind: self.kind.clone(), paused: self.paused_at.is_some(), elapsed: self.elapsed(), mic: self.mic, camera: self.camera }
    }
}

static TICKER: AtomicBool = AtomicBool::new(false);

// ------------------------------------------------------------ devices

#[derive(Serialize)]
pub struct Device {
    pub id: String,
    pub name: String,
}

#[derive(Serialize)]
pub struct Devices {
    pub microphones: Vec<Device>,
    pub cameras: Vec<Device>,
}

#[allow(deprecated)]
pub fn devices() -> Devices {
    let list = |ty: Option<&objc2_av_foundation::AVMediaType>| -> Vec<Device> {
        let Some(ty) = ty else { return vec![] };
        unsafe {
            AVCaptureDevice::devicesWithMediaType(ty)
                .iter()
                .map(|d| Device { id: d.uniqueID().to_string(), name: d.localizedName().to_string() })
                .collect()
        }
    };
    unsafe { Devices { microphones: list(AVMediaTypeAudio), cameras: list(AVMediaTypeVideo) } }
}

// ------------------------------------------------------------ stream

fn even(v: f64) -> usize {
    let v = v.round().max(2.0) as usize;
    v - v % 2
}

fn start_segment(app: &AppHandle, rec: &Recording) -> Result<Segment> {
    // ScreenCaptureKit / AVFoundation report bad configurations by raising
    // Objective-C exceptions; turn them into errors instead of aborting.
    let mut out: Option<Result<Segment>> = None;
    let res = objc2::exception::catch(std::panic::AssertUnwindSafe(|| {
        out = Some(start_segment_inner(app, rec));
    }));
    match res {
        Ok(()) => out.unwrap_or_else(|| Err(anyhow!("recording failed"))),
        Err(e) => Err(anyhow!("An error occurred while starting screen recording: {}", e.map(|e| e.to_string()).unwrap_or_default())),
    }
}

fn start_segment_inner(app: &AppHandle, rec: &Recording) -> Result<Segment> {
    let s = settings();
    let content = sck::shareable_content()?;
    let d = &rec.display;
    let exclude = windows::excluded_window_numbers(app, s.pins_show_on_screenshots);
    let path = crate::paths::unique_path(&crate::paths::temp_dir(), &format!("segment-{}", state::new_id()), "mp4");
    unsafe {
        let config = SCStreamConfiguration::new();
        let (filter, src_w, src_h) = match rec.window_id.and_then(|id| content.window(id)) {
            Some(w) => {
                let f = SCContentFilter::initWithDesktopIndependentWindow(SCContentFilter::alloc(), &w);
                let fr = w.frame();
                (f, fr.size.width, fr.size.height)
            }
            None => {
                let sc_display = content.display(d.id).ok_or_else(|| anyhow!("display not found"))?;
                let excluded = content.windows_by_ids(&exclude);
                let f = SCContentFilter::initWithDisplay_excludingWindows(SCContentFilter::alloc(), &sc_display, &NSArray::from_retained_slice(&excluded));
                config.setSourceRect(CGRect::new(CGPoint::new(rec.rect.x, rec.rect.y), CGSize::new(rec.rect.w, rec.rect.h)));
                (f, rec.rect.w, rec.rect.h)
            }
        };
        let mut scale = if s.rec_scale_retina { 1.0 } else { d.scale };
        if s.rec_max_resolution > 0 {
            let h = src_h * scale;
            if h > s.rec_max_resolution as f64 {
                scale *= s.rec_max_resolution as f64 / h;
            }
        }
        config.setWidth(even(src_w * scale));
        config.setHeight(even(src_h * scale));
        config.setScalesToFit(true);
        config.setShowsCursor(s.rec_show_cursor);
        config.setMinimumFrameInterval(CMTime::new(1, s.rec_video_fps.max(1) as i32));
        config.setQueueDepth(8);
        let gif = rec.kind == "gif";
        let audio = !gif && s.rec_record_computer_audio;
        let mic = !gif && s.rec_record_microphone;
        config.setCapturesAudio(audio);
        config.setExcludesCurrentProcessAudio(true);
        config.setSampleRate(48_000);
        config.setChannelCount(if s.rec_audio_mono { 1 } else { 2 });
        if mic {
            config.setCaptureMicrophone(true);
            if !s.rec_microphone.is_empty() {
                config.setMicrophoneCaptureDeviceID(Some(&NSString::from_str(&s.rec_microphone)));
            }
        }

        let (tx, rx) = mpsc::channel();
        let delegate = RecDelegate::new(tx);
        let stream = SCStream::initWithFilter_configuration_delegate(
            SCStream::alloc(),
            &filter,
            &config,
            Some(ProtocolObject::from_ref(&*delegate)),
        );
        let out_cfg = SCRecordingOutputConfiguration::new();
        out_cfg.setOutputURL(&NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy())));
        let codec = if s.rec_video_encoder == "hevc" && !gif { AVVideoCodecTypeHEVC } else { AVVideoCodecTypeH264 };
        if let Some(c) = codec {
            out_cfg.setVideoCodecType(c);
        }
        if let Some(ft) = AVFileTypeMPEG4 {
            out_cfg.setOutputFileType(ft);
        }
        let output = SCRecordingOutput::initWithConfiguration_delegate(SCRecordingOutput::alloc(), &out_cfg, ProtocolObject::from_ref(&*delegate));
        stream.addRecordingOutput_error(&output).map_err(|e| anyhow!(e.localizedDescription().to_string()))?;

        let (stx, srx) = mpsc::channel::<Option<String>>();
        let block = RcBlock::new(move |err: *mut NSError| {
            let _ = stx.send(if err.is_null() { None } else { Some((*err).localizedDescription().to_string()) });
        });
        stream.startCaptureWithCompletionHandler(Some(&block));
        match srx.recv_timeout(Duration::from_secs(10)) {
            Ok(None) => {}
            Ok(Some(e)) => return Err(anyhow!("An error occurred while starting screen recording: {e}")),
            Err(_) => return Err(anyhow!("Timed out starting the screen recording")),
        }
        Ok(Segment {
            stream: SendPtr(stream),
            _output: SendPtr(output),
            _delegate: SendPtr(delegate),
            finished: rx,
            path,
        })
    }
}

fn stop_segment(seg: Segment) -> Result<PathBuf> {
    let (tx, rx) = mpsc::channel::<()>();
    let block = RcBlock::new(move |_err: *mut NSError| {
        let _ = tx.send(());
    });
    unsafe { seg.stream.0.stopCaptureWithCompletionHandler(Some(&block)) };
    let _ = rx.recv_timeout(Duration::from_secs(10));
    match seg.finished.recv_timeout(Duration::from_secs(15)) {
        Ok(Ok(())) => Ok(seg.path),
        Ok(Err(e)) => Err(anyhow!(e)),
        Err(_) => {
            // some systems never call didFinish; the file is usually complete
            if seg.path.exists() {
                Ok(seg.path)
            } else {
                Err(anyhow!("recording did not finish"))
            }
        }
    }
}

// ------------------------------------------------------------ UI windows

fn rec_windows(app: &AppHandle, d: &Display, r: Rect, show_frame: bool) {
    let s = settings();
    // frame / dim (excluded from the capture)
    if show_frame {
        let label = format!("recframe-{}", d.id);
        windows::close(app, &label);
        let mut spec = Spec::new(&label, "recframe");
        spec.query = vec![
            ("x", r.x.to_string()),
            ("y", r.y.to_string()),
            ("w", r.w.to_string()),
            ("h", r.h.to_string()),
            ("dim", s.rec_dim_screen.to_string()),
        ];
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
    }
    // click & keystroke effects (captured)
    if s.rec_highlight_clicks || s.rec_show_keystrokes {
        let label = format!("recfx-{}", d.id);
        windows::close(app, &label);
        let mut spec = Spec::new(&label, "recfx");
        spec.query = vec![
            ("dx", d.x.to_string()),
            ("dy", d.y.to_string()),
            ("x", r.x.to_string()),
            ("y", r.y.to_string()),
            ("w", r.w.to_string()),
            ("h", r.h.to_string()),
        ];
        spec.width = d.width;
        spec.height = d.height;
        spec.pos = Some((d.x, d.y));
        spec.panel = Some(PanelKind::Passive);
        spec.level = macos::Level::Overlay;
        spec.transparent = true;
        spec.decorations = false;
        spec.resizable = false;
        spec.shadow = false;
        spec.click_through = true;
        let _ = windows::create(app, spec);
        crate::input::start(app, s.rec_highlight_clicks, s.rec_show_keystrokes);
        if s.rec_show_keystrokes && !macos::has_accessibility_permission(false) {
            crate::permissions::prompt_accessibility(app, "keystrokes");
        }
    }
    // camera bubble (captured)
    if s.rec_record_camera {
        open_camera(app, d, r);
    }
}

fn camera_size(s: &crate::settings::Settings) -> f64 {
    match s.rec_camera_size.as_str() {
        "small" => 150.0,
        "large" => 300.0,
        _ => 210.0,
    }
}

fn open_camera(app: &AppHandle, d: &Display, r: Rect) {
    let s = settings();
    let size = camera_size(&s);
    let (w, h) = if s.rec_camera_shape == "roundedRect" { (size * 1.33, size) } else { (size, size) };
    let (x, y) = s
        .rec_camera_pos
        .filter(|(px, py)| *px >= d.x && *px < d.x + d.width && *py >= d.y && *py < d.y + d.height)
        .unwrap_or((d.x + r.x + r.w - w - 24.0, d.y + r.y + r.h - h - 24.0));
    windows::close(app, "camera");
    let mut spec = Spec::new("camera", "camera");
    spec.query = vec![("shape", s.rec_camera_shape.clone()), ("flip", s.rec_camera_flip.to_string()), ("device", s.rec_camera.clone())];
    spec.width = w;
    spec.height = h;
    spec.pos = Some((x, y));
    spec.panel = Some(PanelKind::Key);
    spec.level = macos::Level::Overlay;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    let _ = windows::create(app, spec);
}

fn controls_window(app: &AppHandle, d: &Display, r: Rect) {
    if !settings().rec_show_controls {
        return;
    }
    let (w, h) = (236.0, 44.0);
    let (vx, vy, vw, vh) = macos::visible_frame(app, d.id).unwrap_or((d.x, d.y, d.width, d.height));
    let cx = (d.x + r.x + r.w / 2.0 - w / 2.0).clamp(vx + 8.0, vx + vw - w - 8.0);
    let below = d.y + r.y + r.h + 12.0;
    let above = d.y + r.y - h - 12.0;
    let y = if below + h < vy + vh - 8.0 {
        below
    } else if above > vy + 8.0 {
        above
    } else {
        d.y + r.y + r.h - h - 16.0
    };
    windows::close(app, "recctl");
    let mut spec = Spec::new("recctl", "recctl");
    spec.width = w;
    spec.height = h;
    spec.pos = Some((cx, y));
    spec.panel = Some(PanelKind::Key);
    spec.level = macos::Level::Overlay;
    spec.transparent = true;
    spec.decorations = false;
    spec.resizable = false;
    spec.shadow = false;
    let _ = windows::create(app, spec);
}

fn close_rec_windows(app: &AppHandle) {
    crate::input::stop(app);
    let labels: Vec<String> = app
        .webview_windows()
        .keys()
        .filter(|l| l.starts_with("recframe-") || l.starts_with("recfx-") || *l == "recctl" || *l == "camera")
        .cloned()
        .collect();
    for l in labels {
        windows::close(app, &l);
    }
}

fn set_dnd(on: bool) {
    // Best effort: run user Shortcuts named "Screenshot X DND On/Off" if present.
    let name = if on { "Screenshot X DND On" } else { "Screenshot X DND Off" };
    std::thread::spawn(move || {
        let list = std::process::Command::new("/usr/bin/shortcuts").arg("list").output();
        if let Ok(o) = list {
            if String::from_utf8_lossy(&o.stdout).lines().any(|l| l.trim() == name) {
                let _ = std::process::Command::new("/usr/bin/shortcuts").args(["run", name]).status();
            }
        }
    });
}

// ------------------------------------------------------------ public API

pub fn begin(app: &AppHandle, d: Display, r: Rect, kind: String, window_id: Option<u32>, _opts: serde_json::Value, hid_icons: bool) -> Result<()> {
    let s = settings();
    if state::state().recording.lock().is_some() {
        return Err(anyhow!("A recording is already in progress"));
    }
    let mut hid = hid_icons;
    if s.rec_hide_desktop_icons && !state::state().desktop_icons_hidden.load(Ordering::SeqCst) {
        crate::desktop::set_hidden(app, true);
        hid = true;
    }
    log::info!("recording begin {kind} on display {} rect {:?}", d.id, (r.x, r.y, r.w, r.h));
    rec_windows(app, &d, r, window_id.is_none());
    log::info!("recording windows ready");
    if s.rec_show_countdown {
        crate::capture::countdown(app, &d, Some(r), s.rec_countdown_seconds);
    }
    if s.rec_do_not_disturb {
        set_dnd(true);
    }
    let mut rec = Recording {
        kind,
        display: d.clone(),
        rect: r,
        window_id,
        started: Instant::now(),
        paused_total: Duration::ZERO,
        paused_at: None,
        segments: vec![],
        current: None,
        hid_icons: hid,
        dnd: s.rec_do_not_disturb,
        mic: s.rec_record_microphone,
        camera: s.rec_record_camera,
        app_name: macos::frontmost_app().map(|f| f.name).unwrap_or_default(),
    };
    log::info!("starting stream");
    match start_segment(app, &rec) {
        Ok(seg) => {
            log::info!("stream started");
            rec.current = Some(seg)
        }
        Err(e) => {
            close_rec_windows(app);
            if hid && !hid_icons {
                crate::desktop::set_hidden(app, false);
            }
            return Err(e);
        }
    }
    if s.play_sounds {
        macos::play_sound(app, "start");
    }
    rec.started = Instant::now();
    *state::state().recording.lock() = Some(rec);
    controls_window(app, &d, r);
    crate::tray::refresh(app);
    start_ticker(app);
    Ok(())
}

fn start_ticker(app: &AppHandle) {
    if TICKER.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    std::thread::spawn(move || {
        loop {
            let info = state::state().recording.lock().as_ref().map(|r| r.info());
            let Some(info) = info else { break };
            let secs = info.elapsed as u64;
            if settings().rec_display_time_in_menu_bar {
                let dot = if info.paused { "❚❚" } else { "●" };
                crate::tray::set_title(&app, Some(format!("{dot} {}:{:02}", secs / 60, secs % 60)));
            }
            let _ = app.emit("rec:tick", &info);
            std::thread::sleep(Duration::from_millis(500));
        }
        crate::tray::set_title(&app, None);
        TICKER.store(false, Ordering::SeqCst);
    });
}

pub fn info() -> Option<RecInfo> {
    state::state().recording.lock().as_ref().map(|r| r.info())
}

pub fn toggle_pause(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let st = state::state();
        let mut g = st.recording.lock();
        let Some(rec) = g.as_mut() else { return };
        if let Some(p) = rec.paused_at.take() {
            rec.paused_total += p.elapsed();
            match start_segment(&app, rec) {
                Ok(seg) => rec.current = Some(seg),
                Err(e) => crate::toast::show(&app, "error", "Could not resume recording", &e.to_string()),
            }
        } else if let Some(seg) = rec.current.take() {
            rec.paused_at = Some(Instant::now());
            match stop_segment(seg) {
                Ok(p) => rec.segments.push(p),
                Err(e) => log::error!("pause failed: {e}"),
            }
            if settings().play_sounds {
                macos::play_sound(&app, "countdown");
            }
        }
        let info = rec.info();
        drop(g);
        let _ = app.emit("rec:tick", &info);
    });
}

/// Discard everything and start over.
pub fn restart(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let st = state::state();
        let mut g = st.recording.lock();
        let Some(rec) = g.as_mut() else { return };
        if let Some(seg) = rec.current.take() {
            if let Ok(p) = stop_segment(seg) {
                let _ = std::fs::remove_file(p);
            }
        }
        for p in rec.segments.drain(..) {
            let _ = std::fs::remove_file(p);
        }
        rec.paused_at = None;
        rec.paused_total = Duration::ZERO;
        match start_segment(&app, rec) {
            Ok(seg) => {
                rec.current = Some(seg);
                rec.started = Instant::now();
            }
            Err(e) => crate::toast::show(&app, "error", "Could not restart recording", &e.to_string()),
        }
    });
}

fn teardown(app: &AppHandle, rec: &Recording) {
    close_rec_windows(app);
    if rec.hid_icons {
        crate::desktop::set_hidden(app, false);
    }
    if rec.dnd {
        set_dnd(false);
    }
    crate::tray::refresh(app);
}

/// Cancel and delete the recording.
pub fn discard(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let rec = state::state().recording.lock().take();
        let Some(mut rec) = rec else { return };
        if let Some(seg) = rec.current.take() {
            if let Ok(p) = stop_segment(seg) {
                let _ = std::fs::remove_file(p);
            }
        }
        for p in rec.segments.drain(..) {
            let _ = std::fs::remove_file(p);
        }
        teardown(&app, &rec);
    });
}

pub fn stop(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        let rec = state::state().recording.lock().take();
        let Some(mut rec) = rec else { return };
        let duration = rec.elapsed();
        if let Some(seg) = rec.current.take() {
            match stop_segment(seg) {
                Ok(p) => rec.segments.push(p),
                Err(e) => crate::toast::show(&app, "error", "Recording Failed", &e.to_string()),
            }
        }
        teardown(&app, &rec);
        if rec.segments.is_empty() {
            return;
        }
        if let Err(e) = finalize(&app, &rec, duration) {
            log::error!("finalize failed: {e:#}");
            crate::toast::show(&app, "error", "An error occurred with processing video file.", &e.to_string());
        }
    });
}

fn finalize(app: &AppHandle, rec: &Recording, duration: f64) -> Result<()> {
    let s = settings();
    let kind = if rec.kind == "gif" { CaptureKind::Gif } else { CaptureKind::Video };
    let stem = crate::output::file_stem(&kind, &rec.app_name, "");
    let mp4 = crate::paths::unique_path(&crate::paths::captures_dir(), &stem, "mp4");
    if rec.segments.len() == 1 {
        std::fs::rename(&rec.segments[0], &mp4).or_else(|_| std::fs::copy(&rec.segments[0], &mp4).map(|_| ()))?;
    } else {
        crate::video::concat(&rec.segments, &mp4)?;
        for p in &rec.segments {
            let _ = std::fs::remove_file(p);
        }
    }
    // single audio track (mic + computer audio mixed) and/or mono
    let both = rec.mic && s.rec_record_computer_audio;
    if rec.kind != "gif" && ((both && !s.rec_separate_audio_tracks) || s.rec_audio_mono) {
        let tmp = mp4.with_extension("mixed.mp4");
        match crate::video::mix_audio(&mp4, &tmp, s.rec_audio_mono) {
            Ok(()) => {
                let _ = std::fs::rename(&tmp, &mp4);
            }
            Err(e) => {
                log::warn!("audio merge failed: {e}");
                crate::toast::show(app, "info", "The audio tracks will not be merged.", &e.to_string());
            }
        }
    }
    let (w, h) = crate::video::dimensions(&mp4).unwrap_or((0, 0));
    if rec.kind == "gif" {
        crate::toast::show(app, "info", "Creating GIF…", "This can take a moment.");
        let gif = mp4.with_extension("gif");
        crate::video::to_gif(&mp4, &gif, s.rec_gif_fps, s.rec_gif_max_width, s.rec_gif_quality, s.rec_gif_optimize, None)?;
        let _ = std::fs::remove_file(&mp4);
        crate::toast::hide(app);
        let (gw, gh) = image::image_dimensions(&gif).unwrap_or((w, h));
        crate::output::finish_recording(app, gif, CaptureKind::Gif, gw, gh, duration, rec.app_name.clone());
    } else {
        crate::output::finish_recording(app, mp4, CaptureKind::Video, w, h, duration, rec.app_name.clone());
    }
    Ok(())
}

pub fn toggle_camera_fullscreen(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("camera") {
        let _ = w.emit_to("camera", "camera:toggle-fullscreen", ());
    }
}

/// Camera bubble full-screen toggle: cover the recording area or go back.
pub fn camera_fullscreen(app: &AppHandle, on: bool) {
    let rec = state::state().recording.lock().as_ref().map(|r| (r.display.clone(), r.rect));
    let Some(w) = app.get_webview_window("camera") else { return };
    let s = settings();
    if on {
        let (d, r) = rec.unwrap_or_else(|| {
            let d = crate::displays::under_mouse();
            let r = Rect { x: 0.0, y: 0.0, w: d.width, h: d.height };
            (d, r)
        });
        macos::set_frame_cg(app, &w, d.x + r.x, d.y + r.y, r.w, r.h);
    } else {
        let size = camera_size(&s);
        let (cw, ch) = if s.rec_camera_shape == "roundedRect" { (size * 1.33, size) } else { (size, size) };
        let (x, y) = s.rec_camera_pos.unwrap_or_else(|| {
            let d = crate::displays::under_mouse();
            (d.x + d.width - cw - 40.0, d.y + d.height - ch - 40.0)
        });
        macos::set_frame_cg(app, &w, x, y, cw, ch);
    }
}

/// Show the camera bubble outside of a recording (preview from Settings).
pub fn preview_camera(app: &AppHandle, on: bool) {
    if on {
        let d = crate::displays::under_mouse();
        open_camera(app, &d, Rect { x: 0.0, y: 0.0, w: d.width, h: d.height });
    } else {
        windows::close(app, "camera");
    }
}

pub type Shared = Arc<()>;
