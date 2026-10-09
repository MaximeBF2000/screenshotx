//! Video utilities on AVFoundation: thumbnails, metadata, concatenation,
//! audio mixing, trimming / re-encoding and GIF conversion.

use anyhow::{anyhow, Result};
use block2::RcBlock;
use objc2::rc::Retained;
use objc2::runtime::AnyObject;
use objc2::AnyThread;
use objc2_av_foundation::{
    AVAsset, AVAssetExportSession, AVAssetExportSessionStatus, AVAssetImageGenerator, AVAssetReader,
    AVAssetReaderAudioMixOutput, AVAssetReaderTrackOutput, AVAssetTrack, AVAssetWriter, AVAssetWriterInput, AVAudioMix,
    AVFileTypeMPEG4, AVMediaTypeAudio, AVMediaTypeVideo, AVMutableAudioMix, AVMutableAudioMixInputParameters,
    AVMutableComposition, AVURLAsset,
};
use objc2_core_foundation::CGSize;
use objc2_core_media::{CMFormatDescription, CMTime, CMTimeRange};
use objc2_foundation::{NSArray, NSDictionary, NSNumber, NSString, NSURL};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::mpsc;
use std::time::Duration;
use tauri::{AppHandle, Emitter};

fn url(p: &Path) -> Retained<NSURL> {
    NSURL::fileURLWithPath(&NSString::from_str(&p.to_string_lossy()))
}

fn asset(p: &Path) -> Retained<AVURLAsset> {
    unsafe { AVURLAsset::URLAssetWithURL_options(&url(p), None) }
}

#[allow(deprecated)]
fn tracks(a: &AVAsset, video: bool) -> Vec<Retained<AVAssetTrack>> {
    unsafe {
        let ty = if video { AVMediaTypeVideo } else { AVMediaTypeAudio };
        match ty {
            Some(t) => a.tracksWithMediaType(t).iter().collect(),
            None => vec![],
        }
    }
}

fn time(secs: f64) -> CMTime {
    unsafe { CMTime::new((secs * 600.0).round() as i64, 600) }
}

#[allow(deprecated)]
pub fn duration(p: &Path) -> Option<f64> {
    let a = asset(p);
    let d = unsafe { a.duration().seconds() };
    d.is_finite().then_some(d)
}

#[allow(deprecated)]
pub fn dimensions(p: &Path) -> Option<(u32, u32)> {
    let a = asset(p);
    let t = tracks(&a, true).into_iter().next()?;
    let s = unsafe { t.naturalSize() };
    let tr = unsafe { t.preferredTransform() };
    // rotated tracks swap width/height
    let rotated = tr.b.abs() > 0.5 && tr.c.abs() > 0.5;
    let (w, h) = if rotated { (s.height, s.width) } else { (s.width, s.height) };
    Some((w.round() as u32, h.round() as u32))
}

#[allow(deprecated)]
fn frame_at(gen: &AVAssetImageGenerator, secs: f64) -> Option<image::RgbaImage> {
    unsafe {
        let cg = gen.copyCGImageAtTime_actualTime_error(time(secs), std::ptr::null_mut()).ok()?;
        Some(crate::sck::cgimage_to_rgba(&cg))
    }
}

fn generator(a: &AVAsset, max: Option<(f64, f64)>, exact: bool) -> Retained<AVAssetImageGenerator> {
    unsafe {
        let g = AVAssetImageGenerator::assetImageGeneratorWithAsset(a);
        g.setAppliesPreferredTrackTransform(true);
        if let Some((w, h)) = max {
            g.setMaximumSize(CGSize::new(w, h));
        }
        if exact {
            g.setRequestedTimeToleranceBefore(CMTime::new(0, 600));
            g.setRequestedTimeToleranceAfter(CMTime::new(0, 600));
        }
        g
    }
}

/// JPEG thumbnail of the first frame; returns its path.
pub fn thumbnail(p: &Path) -> Option<String> {
    if p.extension().map(|e| e == "gif").unwrap_or(false) {
        let img = image::open(p).ok()?.to_rgba8();
        return Some(crate::output::make_image_thumb(&img, p));
    }
    let a = asset(p);
    let g = generator(&a, Some((640.0, 640.0)), false);
    let img = frame_at(&g, 0.1).or_else(|| frame_at(&g, 0.0))?;
    Some(crate::output::make_image_thumb(&img, p))
}

/// Filmstrip thumbnails for the editor timeline (paths to JPEGs).
pub fn filmstrip(p: &Path, count: usize, height: f64) -> Vec<String> {
    let Some(d) = duration(p) else { return vec![] };
    let a = asset(p);
    let g = generator(&a, Some((height * 3.0, height)), false);
    let dir = crate::paths::temp_dir().join(format!("strip-{}", crate::state::new_id()));
    let _ = std::fs::create_dir_all(&dir);
    (0..count)
        .filter_map(|i| {
            let t = d * (i as f64 + 0.5) / count as f64;
            let img = frame_at(&g, t)?;
            let out = dir.join(format!("{i}.jpg"));
            let bytes = crate::imageops::encode_jpeg(&img, 70).ok()?;
            std::fs::write(&out, bytes).ok()?;
            Some(out.to_string_lossy().to_string())
        })
        .collect()
}

fn wait_export(session: &AVAssetExportSession) -> Result<()> {
    let (tx, rx) = mpsc::channel::<()>();
    let block = RcBlock::new(move || {
        let _ = tx.send(());
    });
    #[allow(deprecated)]
    unsafe {
        session.exportAsynchronouslyWithCompletionHandler(&block)
    };
    rx.recv_timeout(Duration::from_secs(3600)).map_err(|_| anyhow!("export timed out"))?;
    #[allow(deprecated)]
    let status = unsafe { session.status() };
    if status == AVAssetExportSessionStatus::Completed {
        Ok(())
    } else {
        #[allow(deprecated)]
        let err = unsafe { session.error() }.map(|e| e.localizedDescription().to_string()).unwrap_or_else(|| "export failed".into());
        Err(anyhow!(err))
    }
}

fn preset(name: &str) -> Retained<NSString> {
    NSString::from_str(name)
}

/// Join recording segments (passthrough).
#[allow(deprecated)]
pub fn concat(segments: &[PathBuf], out: &Path) -> Result<()> {
    unsafe {
        let comp = AVMutableComposition::composition();
        let mut cursor = CMTime::new(0, 600);
        let vt = comp.addMutableTrackWithMediaType_preferredTrackID(AVMediaTypeVideo.unwrap(), 0);
        let mut ats: Vec<Retained<objc2_av_foundation::AVMutableCompositionTrack>> = vec![];
        for seg in segments {
            let a = asset(seg);
            let dur = a.duration();
            let range = CMTimeRange { start: CMTime::new(0, 600), duration: dur };
            if let (Some(vt), Some(src)) = (&vt, tracks(&a, true).first()) {
                vt.insertTimeRange_ofTrack_atTime_error(range, src, cursor).map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
            }
            for (i, src) in tracks(&a, false).iter().enumerate() {
                while ats.len() <= i {
                    if let Some(t) = comp.addMutableTrackWithMediaType_preferredTrackID(AVMediaTypeAudio.unwrap(), 0) {
                        ats.push(t);
                    }
                }
                let _ = ats[i].insertTimeRange_ofTrack_atTime_error(range, src, cursor);
            }
            cursor = objc2_core_media::CMTimeAdd(cursor, dur);
        }
        let session = AVAssetExportSession::exportSessionWithAsset_presetName(&comp, &preset("AVAssetExportPresetPassthrough"))
            .ok_or_else(|| anyhow!("no export session"))?;
        session.setOutputURL(Some(&url(out)));
        session.setOutputFileType(AVFileTypeMPEG4);
        wait_export(&session)
    }
}

fn num(v: f64) -> Retained<AnyObject> {
    Retained::into_super(Retained::into_super(Retained::into_super(NSNumber::new_f64(v))))
}

fn dict(pairs: &[(&str, Retained<AnyObject>)]) -> Retained<NSDictionary<NSString, AnyObject>> {
    let keys: Vec<Retained<NSString>> = pairs.iter().map(|(k, _)| NSString::from_str(k)).collect();
    let krefs: Vec<&NSString> = keys.iter().map(|k| &**k).collect();
    let vrefs: Vec<&AnyObject> = pairs.iter().map(|(_, v)| &**v).collect();
    NSDictionary::from_slices(&krefs, &vrefs)
}

const LPCM: f64 = 0x6C70636D as f64; // 'lpcm'
const AAC: f64 = 0x61616320 as f64; // 'aac '

/// Rewrite `src` with all audio tracks mixed into one AAC track (video is
/// passed through untouched). `volume` scales the audio, `mono` downmixes.
#[allow(deprecated)]
pub fn rewrite_audio(src: &Path, dst: &Path, mono: bool, volume: f32, mute: bool, range: Option<(f64, f64)>) -> Result<()> {
    unsafe {
        let a = asset(src);
        let reader = AVAssetReader::assetReaderWithAsset_error(&a).map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
        if let Some((s, e)) = range {
            reader.setTimeRange(CMTimeRange { start: time(s), duration: time(e - s) });
        }
        let vtrack = tracks(&a, true).into_iter().next().ok_or_else(|| anyhow!("There is no video track!"))?;
        let vout = AVAssetReaderTrackOutput::assetReaderTrackOutputWithTrack_outputSettings(&vtrack, None);
        vout.setAlwaysCopiesSampleData(false);
        reader.addOutput(&vout);
        let atracks = tracks(&a, false);
        let channels = if mono { 1.0 } else { 2.0 };
        let aout = if !atracks.is_empty() && !mute {
            let settings = dict(&[
                ("AVFormatIDKey", num(LPCM)),
                ("AVLinearPCMBitDepthKey", num(16.0)),
                ("AVLinearPCMIsFloatKey", num(0.0)),
                ("AVLinearPCMIsBigEndianKey", num(0.0)),
                ("AVLinearPCMIsNonInterleaved", num(0.0)),
                ("AVNumberOfChannelsKey", num(channels)),
                ("AVSampleRateKey", num(48_000.0)),
            ]);
            let arr = NSArray::from_retained_slice(&atracks);
            let o = AVAssetReaderAudioMixOutput::assetReaderAudioMixOutputWithAudioTracks_audioSettings(&arr, Some(&settings));
            if (volume - 1.0).abs() > 0.01 {
                let mix = AVMutableAudioMix::audioMix();
                let params: Vec<Retained<objc2_av_foundation::AVAudioMixInputParameters>> = atracks
                    .iter()
                    .map(|t| {
                        let p = AVMutableAudioMixInputParameters::audioMixInputParametersWithTrack(Some(t));
                        p.setVolume_atTime(volume, CMTime::new(0, 600));
                        Retained::into_super(p)
                    })
                    .collect();
                mix.setInputParameters(&NSArray::from_retained_slice(&params));
                let m: Retained<AVAudioMix> = Retained::into_super(mix);
                o.setAudioMix(Some(&m));
            }
            reader.addOutput(&o);
            Some(o)
        } else {
            None
        };

        let _ = std::fs::remove_file(dst);
        let writer = AVAssetWriter::assetWriterWithURL_fileType_error(&url(dst), AVFileTypeMPEG4.unwrap())
            .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
        let fmts = vtrack.formatDescriptions();
        let hint: Option<&CMFormatDescription> = fmts.firstObject().map(|o| &*(Retained::into_raw(o) as *const CMFormatDescription));
        let vin = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings_sourceFormatHint(AVMediaTypeVideo.unwrap(), None, hint);
        vin.setExpectsMediaDataInRealTime(false);
        vin.setTransform(vtrack.preferredTransform());
        writer.addInput(&vin);
        let ain = aout.as_ref().map(|_| {
            let settings = dict(&[
                ("AVFormatIDKey", num(AAC)),
                ("AVNumberOfChannelsKey", num(channels)),
                ("AVSampleRateKey", num(48_000.0)),
                ("AVEncoderBitRateKey", num(if mono { 96_000.0 } else { 192_000.0 })),
            ]);
            let i = AVAssetWriterInput::assetWriterInputWithMediaType_outputSettings_sourceFormatHint(AVMediaTypeAudio.unwrap(), Some(&settings), None);
            i.setExpectsMediaDataInRealTime(false);
            writer.addInput(&i);
            i
        });
        if !reader.startReading() {
            return Err(anyhow!("could not read video"));
        }
        writer.startWriting();
        writer.startSessionAtSourceTime(range.map(|(s, _)| time(s)).unwrap_or(CMTime::new(0, 600)));

        // pump video and audio on separate threads so neither input starves
        struct Pump(Retained<objc2_av_foundation::AVAssetReaderOutput>, Retained<AVAssetWriterInput>);
        unsafe impl Send for Pump {}
        let mut pumps = vec![Pump(Retained::into_super(vout), vin)];
        if let (Some(o), Some(i)) = (aout, ain) {
            pumps.push(Pump(Retained::into_super(o), i));
        }
        let handles: Vec<_> = pumps
            .into_iter()
            .map(|p| {
                std::thread::spawn(move || {
                    let p = p;
                    while let Some(buf) = p.0.copyNextSampleBuffer() {
                        while !p.1.isReadyForMoreMediaData() {
                            std::thread::sleep(Duration::from_millis(2));
                        }
                        if !p.1.appendSampleBuffer(&buf) {
                            break;
                        }
                    }
                    p.1.markAsFinished();
                })
            })
            .collect();
        for h in handles {
            let _ = h.join();
        }
        let (tx, rx) = mpsc::channel::<()>();
        let block = RcBlock::new(move || {
            let _ = tx.send(());
        });
        writer.finishWritingWithCompletionHandler(&block);
        rx.recv_timeout(Duration::from_secs(600)).map_err(|_| anyhow!("writer timed out"))?;
        if let Some(e) = writer.error() {
            return Err(anyhow!(e.localizedDescription().to_string()));
        }
        Ok(())
    }
}

pub fn mix_audio(src: &Path, dst: &Path, mono: bool) -> Result<()> {
    rewrite_audio(src, dst, mono, 1.0, false, None)
}

// ------------------------------------------------------------ export

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportOpts {
    pub start: f64,
    pub end: f64,
    /// high | medium | low
    pub quality: String,
    /// 0 = original, else max height (2160, 1080, 720, 480)
    pub resolution: u32,
    /// keep | mute | mono | volume
    pub audio: String,
    pub volume: f32,
    /// mp4 | gif
    pub format: String,
    pub gif_fps: u32,
    pub gif_width: u32,
    pub gif_quality: u32,
    /// replace | new
    pub save_mode: String,
}

fn export_preset(o: &ExportOpts) -> &'static str {
    match (o.resolution, o.quality.as_str()) {
        (2160, _) => "AVAssetExportPreset3840x2160",
        (1080, _) => "AVAssetExportPreset1920x1080",
        (720, _) => "AVAssetExportPreset1280x720",
        (480, _) => "AVAssetExportPreset640x480",
        (_, "low") => "AVAssetExportPresetLowQuality",
        (_, "medium") => "AVAssetExportPresetMediumQuality",
        _ => "AVAssetExportPresetHighestQuality",
    }
}

/// Trim / re-encode / change audio. Returns the output path.
#[allow(deprecated)]
pub fn export(src: &Path, o: &ExportOpts, progress: impl Fn(f64) + Send + 'static) -> Result<PathBuf> {
    let dir = src.parent().unwrap_or(Path::new("/tmp"));
    let stem = src.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let tmp = crate::paths::temp_dir().join(format!("export-{}.mp4", crate::state::new_id()));
    let total = duration(src).unwrap_or(o.end);
    let trimmed = o.start > 0.01 || o.end < total - 0.01;
    let reencode = o.quality != "high" || o.resolution != 0;
    progress(0.05);
    if reencode || o.audio == "mute" {
        unsafe {
            let a = asset(src);
            let source: Retained<AVAsset> = if o.audio == "mute" {
                // composition with the video track only
                let comp = AVMutableComposition::composition();
                if let (Some(vt), Some(src_t)) = (comp.addMutableTrackWithMediaType_preferredTrackID(AVMediaTypeVideo.unwrap(), 0), tracks(&a, true).first()) {
                    vt.insertTimeRange_ofTrack_atTime_error(CMTimeRange { start: CMTime::new(0, 600), duration: a.duration() }, src_t, CMTime::new(0, 600))
                        .map_err(|e| anyhow!(e.localizedDescription().to_string()))?;
                    vt.setPreferredTransform(src_t.preferredTransform());
                }
                Retained::into_super(Retained::into_super(comp))
            } else {
                Retained::into_super(a)
            };
            let name = if reencode { export_preset(o) } else { "AVAssetExportPresetPassthrough" };
            let session = AVAssetExportSession::exportSessionWithAsset_presetName(&source, &preset(name)).ok_or_else(|| anyhow!("no export session"))?;
            session.setOutputURL(Some(&url(&tmp)));
            session.setOutputFileType(AVFileTypeMPEG4);
            session.setShouldOptimizeForNetworkUse(true);
            if trimmed {
                session.setTimeRange(CMTimeRange { start: time(o.start), duration: time(o.end - o.start) });
            }
            if o.audio == "volume" && (o.volume - 1.0).abs() > 0.01 {
                let mix = AVMutableAudioMix::audioMix();
                let params: Vec<Retained<objc2_av_foundation::AVAudioMixInputParameters>> = tracks(&source, false)
                    .iter()
                    .map(|t| {
                        let p = AVMutableAudioMixInputParameters::audioMixInputParametersWithTrack(Some(t));
                        p.setVolume_atTime(o.volume, CMTime::new(0, 600));
                        Retained::into_super(p)
                    })
                    .collect();
                mix.setInputParameters(&NSArray::from_retained_slice(&params));
                session.setAudioMix(Some(&mix));
            }
            wait_export(&session)?;
        }
        if o.audio == "mono" {
            let t2 = tmp.with_extension("mono.mp4");
            rewrite_audio(&tmp, &t2, true, 1.0, false, None)?;
            std::fs::rename(&t2, &tmp)?;
        }
    } else {
        // passthrough video; audio rewritten only if needed
        let range = trimmed.then_some((o.start, o.end));
        match o.audio.as_str() {
            "mono" => rewrite_audio(src, &tmp, true, 1.0, false, range)?,
            "volume" if (o.volume - 1.0).abs() > 0.01 => rewrite_audio(src, &tmp, false, o.volume, false, range)?,
            _ => {
                if trimmed {
                    unsafe {
                        let a = asset(src);
                        let session = AVAssetExportSession::exportSessionWithAsset_presetName(&a, &preset("AVAssetExportPresetPassthrough")).ok_or_else(|| anyhow!("no export session"))?;
                        session.setOutputURL(Some(&url(&tmp)));
                        session.setOutputFileType(AVFileTypeMPEG4);
                        session.setTimeRange(CMTimeRange { start: time(o.start), duration: time(o.end - o.start) });
                        wait_export(&session)?;
                    }
                } else {
                    std::fs::copy(src, &tmp)?;
                }
            }
        }
    }
    progress(0.6);
    let out_path = if o.format == "gif" {
        let gif = crate::paths::unique_path(dir, &stem, "gif");
        to_gif(&tmp, &gif, o.gif_fps, o.gif_width, o.gif_quality, true, Some(Box::new(move |p| progress(0.6 + p * 0.4))))?;
        let _ = std::fs::remove_file(&tmp);
        gif
    } else if o.save_mode == "replace" {
        std::fs::rename(&tmp, src).or_else(|_| std::fs::copy(&tmp, src).map(|_| ()))?;
        src.to_path_buf()
    } else {
        let p = crate::paths::unique_path(dir, &format!("{stem} edited"), "mp4");
        std::fs::rename(&tmp, &p).or_else(|_| std::fs::copy(&tmp, &p).map(|_| ()))?;
        p
    };
    Ok(out_path)
}

/// Convert a video to an optimized GIF with gifski.
pub fn to_gif(src: &Path, dst: &Path, fps: u32, max_width: u32, quality: u32, optimize: bool, progress: Option<Box<dyn Fn(f64) + Send>>) -> Result<()> {
    let d = duration(src).ok_or_else(|| anyhow!("invalid video"))?;
    let fps = fps.clamp(1, 50) as f64;
    let n = ((d * fps).floor() as usize).max(1);
    let (vw, vh) = dimensions(src).unwrap_or((800, 600));
    let target_w = if max_width > 0 && vw > max_width { max_width } else { vw };
    let target_h = (vh as f64 * target_w as f64 / vw.max(1) as f64).round() as u32;
    let a = asset(src);
    let gen = generator(&a, Some((target_w as f64, target_h as f64)), true);
    let gen = crate::macos::SendPtr(gen);
    let mut gs = gifski::Settings::default();
    gs.quality = quality.clamp(1, 100) as u8;
    gs.fast = !optimize;
    gs.width = Some(target_w);
    let (collector, writer) = gifski::new(gs).map_err(|e| anyhow!("{e}"))?;
    let dst2 = dst.to_path_buf();
    let wt = std::thread::spawn(move || -> Result<()> {
        let f = std::fs::File::create(&dst2)?;
        writer.write(f, &mut gifski::progress::NoProgress {}).map_err(|e| anyhow!("{e}"))?;
        Ok(())
    });
    for i in 0..n {
        let t = i as f64 / fps;
        let gen = &gen;
        if let Some(img) = frame_at(&gen.0, t.min(d - 0.001)) {
            let (w, h) = (img.width() as usize, img.height() as usize);
            let pixels: Vec<rgb::RGBA8> = img.into_raw().chunks_exact(4).map(|c| rgb::RGBA8::new(c[0], c[1], c[2], c[3])).collect();
            let frame = imgref::ImgVec::new(pixels, w, h);
            collector.add_frame_rgba(i, frame, t).map_err(|e| anyhow!("{e}"))?;
        }
        if let Some(p) = &progress {
            p((i + 1) as f64 / n as f64 * 0.9);
        }
    }
    drop(collector);
    wt.join().map_err(|_| anyhow!("gif writer panicked"))??;
    if let Some(p) = &progress {
        p(1.0);
    }
    Ok(())
}

pub fn convert_to_gif_async(app: &AppHandle, path: String) {
    let app = app.clone();
    std::thread::spawn(move || {
        let s = crate::state::settings();
        let src = PathBuf::from(&path);
        let dst = crate::paths::unique_path(src.parent().unwrap_or(Path::new("/tmp")), &src.file_stem().unwrap_or_default().to_string_lossy(), "gif");
        crate::toast::show(&app, "info", "Converting Video…", "Creating a GIF from your recording.");
        match to_gif(&src, &dst, s.rec_gif_fps, s.rec_gif_max_width, s.rec_gif_quality, s.rec_gif_optimize, None) {
            Ok(()) => {
                crate::toast::hide(&app);
                crate::commands::add_file_to_quick_access(&app, &dst.to_string_lossy());
            }
            Err(e) => crate::toast::show(&app, "error", "Could not create GIF", &e.to_string()),
        }
    });
}

pub fn open_editor(app: &AppHandle, path: &str) {
    let label = format!("video-{}", crate::state::new_id());
    let mut spec = crate::windows::Spec::new(&label, "video");
    spec.title = "Video Editor";
    spec.query = vec![("path", path.to_string())];
    spec.width = 980.0;
    spec.height = 700.0;
    spec.min_size = Some((720.0, 520.0));
    spec.overlay_titlebar = true;
    spec.visible = false;
    let _ = crate::windows::create(app, spec);
}

/// Run an export in the background, reporting progress to the editor window.
pub fn export_async(app: &AppHandle, label: String, src: String, opts: ExportOpts) {
    let app = app.clone();
    std::thread::spawn(move || {
        let app2 = app.clone();
        let label2 = label.clone();
        let res = export(Path::new(&src), &opts, move |p| {
            let _ = app2.emit_to(&label2, "video:progress", p);
        });
        match res {
            Ok(p) => {
                let _ = app.emit_to(&label, "video:done", p.to_string_lossy().to_string());
            }
            Err(e) => {
                let _ = app.emit_to(&label, "video:error", e.to_string());
            }
        }
    });
}
