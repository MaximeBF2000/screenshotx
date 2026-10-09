import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Pause, Play, Volume2, VolumeX } from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { basename, closeSelf, fileUrl, formatBytes, invoke, isTauri, listenHere, params, ready } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { Button, Segmented, Select, Slider } from "../../components/ui";

const path = params.get("path") ?? "";

interface Info {
  duration: number;
  width: number;
  height: number;
  size: number;
}

function fmt(t: number) {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(2).padStart(5, "0")}`;
}

export default function VideoEditor() {
  const settings = useSettings((s) => s.settings);
  const video = useRef<HTMLVideoElement>(null);
  const track = useRef<HTMLDivElement>(null);
  const [info, setInfo] = useState<Info | null>(null);
  const [strip, setStrip] = useState<string[]>([]);
  const [start, setStart] = useState(0);
  const [end, setEnd] = useState(0);
  const [cur, setCur] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<"high" | "medium" | "low">("high");
  const [resolution, setResolution] = useState(0);
  const [audio, setAudio] = useState<"keep" | "mute" | "mono" | "volume">("keep");
  const [volume, setVolume] = useState(1);
  const [format, setFormat] = useState<"mp4" | "gif">(path.endsWith(".gif") ? "gif" : "mp4");
  const [gifFps, setGifFps] = useState(15);
  const [gifWidth, setGifWidth] = useState(800);
  const [gifQuality, setGifQuality] = useState(80);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const drag = useRef<"start" | "end" | "head" | null>(null);

  useEffect(() => {
    if (settings) {
      setGifFps(settings.recGifFps ?? 15);
      setGifWidth(settings.recGifMaxWidth ?? 800);
      setGifQuality(settings.recGifQuality ?? 80);
    }
  }, [settings?.recGifFps]);

  useEffect(() => {
    invoke<Info>("video_info", { path })
      .then((i) => {
        if (!i) return;
        setInfo(i);
        setEnd(i.duration);
        ready();
        invoke<string[]>("video_filmstrip", { path, count: 12 }).then((s) => s && setStrip(s));
      })
      .catch((e) => {
        setError(String(e));
        ready();
      });
    const un1 = listenHere<number>("video:progress", (p) => setProgress(p));
    const un2 = listenHere<string>("video:done", async (p) => {
      setProgress(null);
      await invoke("add_to_quick_access", { path: p });
      closeSelf();
    });
    const un3 = listenHere<string>("video:error", (e) => {
      setProgress(null);
      setError(e);
    });
    return () => {
      [un1, un2, un3].forEach((u) => u.then((f) => f()));
    };
  }, []);

  // keep playback within the trimmed range
  useEffect(() => {
    const v = video.current;
    if (!v) return;
    const onTime = () => {
      setCur(v.currentTime);
      if (v.currentTime >= end - 0.02 && !v.paused) {
        v.pause();
        v.currentTime = start;
      }
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [start, end]);

  const toggle = useCallback(() => {
    const v = video.current;
    if (!v) return;
    if (v.paused) {
      if (v.currentTime < start || v.currentTime >= end - 0.05) v.currentTime = start;
      v.play();
    } else v.pause();
  }, [start, end]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest("input, select")) return;
      const v = video.current;
      if (!v) return;
      if (e.code === "Space") (e.preventDefault(), toggle());
      else if (e.key === "ArrowLeft") v.currentTime = Math.max(start, v.currentTime - (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === "ArrowRight") v.currentTime = Math.min(end, v.currentTime + (e.shiftKey ? 1 : 1 / 30));
      else if (e.key === "i") setStart(Math.min(v.currentTime, end - 0.1));
      else if (e.key === "o") setEnd(Math.max(v.currentTime, start + 0.1));
      else if (e.key === "Escape" || (e.metaKey && e.key === "w")) closeSelf();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, start, end]);

  const timeAt = (clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - r.left) / r.width)) * (info?.duration ?? 0);
  };
  const onMove = (e: React.PointerEvent) => {
    if (!drag.current || !info) return;
    const t = timeAt(e.clientX);
    const v = video.current!;
    if (drag.current === "start") {
      const s = Math.min(t, end - 0.1);
      setStart(s);
      v.currentTime = s;
    } else if (drag.current === "end") {
      const en = Math.max(t, start + 0.1);
      setEnd(en);
      v.currentTime = en;
    } else {
      v.currentTime = Math.max(start, Math.min(end, t));
    }
  };

  if (error && !info) return <div className="h-full flex items-center justify-center text-[var(--text-2)] p-8 text-center">{error}</div>;
  if (!info) return <div className="h-full flex items-center justify-center text-[var(--text-2)]">Loading…</div>;

  const pct = (t: number) => `${(t / info.duration) * 100}%`;
  const sel = end - start;
  const qf = quality === "high" ? 1 : quality === "medium" ? 0.55 : 0.3;
  const rf = resolution && info.height > resolution ? (resolution / info.height) ** 2 : 1;
  const estimate =
    format === "gif"
      ? sel * gifFps * (Math.min(gifWidth || info.width, info.width) ** 2 * 0.5625) * 0.12 * (gifQuality / 100)
      : (info.size / info.duration) * sel * qf * rf * (audio === "mute" ? 0.92 : 1);
  const src = isTauri ? convertFileSrc(path) : fileUrl(path);

  const exportVideo = (saveMode: "replace" | "new") => {
    setError(null);
    setProgress(0.01);
    invoke("video_export", {
      path,
      opts: { start, end, quality, resolution, audio, volume, format, gifFps, gifWidth, gifQuality, saveMode },
    });
  };

  return (
    <div className="h-full flex flex-col">
      <div className="h-[52px] shrink-0 flex items-center pl-[84px] pr-4 border-b border-[var(--border)]" data-tauri-drag-region>
        <span className="text-[13px] font-semibold truncate" data-tauri-drag-region>
          {basename(path)}
        </span>
        <span className="ml-2 text-[11.5px] text-[var(--text-2)]">
          {info.width}×{info.height} · {formatBytes(info.size)}
        </span>
      </div>

      <div className="flex-1 min-h-0 bg-black flex items-center justify-center relative" onClick={toggle}>
        <video ref={video} src={src} muted={muted} className="max-w-full max-h-full" preload="auto" onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} />
        {!playing && (
          <div className="absolute w-16 h-16 rounded-full hud flex items-center justify-center pointer-events-none">
            <Play size={26} fill="white" />
          </div>
        )}
      </div>

      {/* transport + timeline */}
      <div className="shrink-0 px-4 pt-3 pb-2 border-t border-[var(--border)] bg-[var(--win-bg)]">
        <div className="flex items-center gap-3">
          <button onClick={toggle} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--hover)]" title="Play / Pause (Space)">
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
          </button>
          <span className="text-[11.5px] tabular-nums text-[var(--text-2)] w-[64px]">{fmt(cur)}</span>
          <div
            ref={track}
            className="relative flex-1 h-[56px] rounded-[8px] overflow-hidden bg-black/80 select-none"
            onPointerDown={(e) => {
              (e.target as HTMLElement).setPointerCapture(e.pointerId);
              const h = (e.target as HTMLElement).dataset.h as "start" | "end" | undefined;
              drag.current = h ?? "head";
              if (!h) onMove(e);
            }}
            onPointerMove={onMove}
            onPointerUp={() => (drag.current = null)}
          >
            <div className="absolute inset-0 flex">
              {strip.map((s, i) => (
                <img key={i} src={fileUrl(s)} className="h-full flex-1 object-cover min-w-0" draggable={false} />
              ))}
            </div>
            <div className="absolute inset-y-0 left-0 bg-black/60" style={{ width: pct(start) }} />
            <div className="absolute inset-y-0 right-0 bg-black/60" style={{ left: pct(end) }} />
            <div className="absolute inset-y-0 border-y-[3px] border-[#ffcc00] pointer-events-none" style={{ left: pct(start), right: `calc(100% - ${pct(end)})` }} />
            <div data-h="start" className="absolute inset-y-0 w-3 -ml-1 bg-[#ffcc00] rounded-l-[6px] cursor-ew-resize flex items-center justify-center" style={{ left: pct(start) }}>
              <span className="w-[2px] h-4 bg-black/50 rounded pointer-events-none" />
            </div>
            <div data-h="end" className="absolute inset-y-0 w-3 -ml-2 bg-[#ffcc00] rounded-r-[6px] cursor-ew-resize flex items-center justify-center" style={{ left: pct(end) }}>
              <span className="w-[2px] h-4 bg-black/50 rounded pointer-events-none" />
            </div>
            <div className="absolute -top-0 bottom-0 w-[2px] bg-white shadow pointer-events-none" style={{ left: pct(cur) }} />
          </div>
          <span className="text-[11.5px] tabular-nums text-[var(--text-2)] w-[64px] text-right">{fmt(sel)}</span>
          <button onClick={() => setMuted(!muted)} className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-[var(--hover)]" title="Mute preview">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>
        </div>
        <div className="text-[11px] text-[var(--text-3)] mt-1 ml-[108px]">Drag the yellow handles to trim · I / O set in and out points · ← → step frames</div>
      </div>

      {/* export options */}
      <div className="shrink-0 px-5 py-3 border-t border-[var(--border)] bg-[var(--win-bg)] flex flex-wrap items-center gap-x-6 gap-y-2.5 text-[12.5px]">
        <label className="flex items-center gap-2">
          Format
          <Segmented size="sm" value={format} onChange={setFormat} options={[{ value: "mp4", label: "MP4" }, { value: "gif", label: "GIF" }]} />
        </label>
        {format === "mp4" ? (
          <>
            <label className="flex items-center gap-2">
              Video quality
              <Segmented size="sm" value={quality} onChange={setQuality} options={[{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }]} />
            </label>
            <label className="flex items-center gap-2">
              Resolution
              <Select
                value={resolution}
                onChange={setResolution}
                width={120}
                options={[
                  { value: 0, label: "Original" },
                  ...[2160, 1080, 720, 480].filter((r) => r < info.height).map((r) => ({ value: r, label: `${r}p` })),
                ]}
              />
            </label>
            <label className="flex items-center gap-2">
              Audio
              <Select
                value={audio}
                onChange={setAudio}
                width={140}
                options={[
                  { value: "keep", label: "Don't change" },
                  { value: "mute", label: "Mute" },
                  { value: "mono", label: "Convert to mono" },
                  { value: "volume", label: "Change volume" },
                ]}
              />
              {audio === "volume" && (
                <>
                  <Slider value={volume} min={0} max={2} step={0.05} onChange={setVolume} width={90} />
                  <span className="tabular-nums w-9 text-[var(--text-2)]">{Math.round(volume * 100)}%</span>
                </>
              )}
            </label>
          </>
        ) : (
          <>
            <label className="flex items-center gap-2">
              FPS
              <Segmented size="sm" value={gifFps} onChange={setGifFps} options={[10, 15, 20, 30].map((f) => ({ value: f, label: String(f) }))} />
            </label>
            <label className="flex items-center gap-2">
              Width
              <Select value={gifWidth} onChange={setGifWidth} width={110} options={[0, 1280, 1024, 800, 640, 480].map((w) => ({ value: w, label: w ? `${w}px` : "Original" }))} />
            </label>
            <label className="flex items-center gap-2">
              Quality
              <Slider value={gifQuality} min={20} max={100} onChange={setGifQuality} width={100} />
            </label>
          </>
        )}
        <div className="flex-1" />
        <span className="text-[var(--text-2)]">
          Estimated file size: <b className="text-[var(--text)] font-medium">{formatBytes(Math.max(0, Math.round(estimate)))}</b>
        </span>
      </div>
      <div className="shrink-0 px-5 pb-4 bg-[var(--win-bg)] flex items-center gap-2">
        {error && <span className="text-[12px] text-[#ff3b30] truncate">{error}</span>}
        <div className="flex-1" />
        <Button onClick={closeSelf}>Cancel</Button>
        <Button onClick={() => exportVideo("new")}>{format === "gif" ? "Export GIF" : "Save as New Video"}</Button>
        {format === "mp4" && (
          <Button primary onClick={() => exportVideo("replace")}>
            {quality === "high" && !resolution && audio === "keep" ? "Trim Only" : "Trim & Convert"}
          </Button>
        )}
      </div>

      {progress !== null && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="w-[300px] rounded-xl bg-[var(--panel)] p-5 shadow-2xl">
            <div className="text-[13px] font-semibold mb-3">{format === "gif" ? "Creating GIF…" : "Processing video…"}</div>
            <div className="h-1.5 rounded-full bg-[var(--hover)] overflow-hidden">
              <div className={clsx("h-full bg-[var(--accent)] transition-[width]")} style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
            <div className="text-[11.5px] text-[var(--text-2)] mt-2 tabular-nums">{Math.round(progress * 100)}%</div>
          </div>
        </div>
      )}
    </div>
  );
}
