import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import clsx from "clsx";
import {
  Camera,
  Clapperboard,
  Info,
  Keyboard,
  Layers,
  PenTool,
  Settings as Gear,
  SlidersHorizontal,
  Wallpaper,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke, listenHere, params, ready } from "../../lib/ipc";
import appIcon from "../../../src-tauri/icons/128x128@2x.png";
import { useSettings, type AfterCapture } from "../../lib/settings";
import { Button, Checkbox, NumberField, Segmented, Select, Slider } from "../../components/ui";
import { ShortcutRecorder } from "./ShortcutRecorder";

type Tab = "general" | "wallpaper" | "shortcuts" | "quickaccess" | "recording" | "screenshots" | "annotate" | "advanced" | "about";

const TABS: { id: Tab; label: string; icon: ReactNode }[] = [
  { id: "general", label: "General", icon: <Gear size={20} /> },
  { id: "wallpaper", label: "Wallpaper", icon: <Wallpaper size={20} /> },
  { id: "shortcuts", label: "Shortcuts", icon: <Keyboard size={20} /> },
  { id: "quickaccess", label: "Quick Access", icon: <Layers size={20} /> },
  { id: "recording", label: "Recording", icon: <Clapperboard size={20} /> },
  { id: "screenshots", label: "Screenshots", icon: <Camera size={20} /> },
  { id: "annotate", label: "Annotate", icon: <PenTool size={20} /> },
  { id: "advanced", label: "Advanced", icon: <SlidersHorizontal size={20} /> },
  { id: "about", label: "About", icon: <Info size={20} /> },
];

export default function Prefs() {
  const settings = useSettings((s) => s.settings);
  const initial = (params.get("tab") as Tab) ?? "general";
  const [tab, setTab] = useState<Tab>(TABS.some((t) => t.id === initial) ? initial : "general");
  const shown = useRef(false);

  useEffect(() => {
    const un = listenHere<string>("prefs:tab", (t) => TABS.some((x) => x.id === t) && setTab(t as Tab));
    return () => {
      un.then((f) => f());
    };
  }, []);
  useEffect(() => {
    if (settings && !shown.current) {
      shown.current = true;
      ready();
    }
  }, [settings]);

  if (!settings) return null;
  return (
    <div className="h-full flex flex-col">
      <div className="shrink-0 pt-[30px] pb-1.5 border-b border-[var(--border)] bg-[var(--win-bg)]" data-tauri-drag-region>
        <div className="flex justify-center gap-0.5 px-3" data-tauri-drag-region>
          {TABS.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={clsx(
                "w-[74px] h-[50px] rounded-[8px] flex flex-col items-center justify-center gap-1 text-[11px] transition-colors",
                tab === t.id ? "bg-[var(--hover)] text-[var(--accent)]" : "text-[var(--text-2)] hover:text-[var(--text)]",
              )}
            >
              {t.icon}
              <span className={clsx(tab === t.id && "text-[var(--text)] font-medium")}>{t.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-10 py-6">
        {tab === "general" && <General />}
        {tab === "wallpaper" && <WallpaperTab />}
        {tab === "shortcuts" && <Shortcuts />}
        {tab === "quickaccess" && <QuickAccessTab />}
        {tab === "recording" && <Recording />}
        {tab === "screenshots" && <Screenshots />}
        {tab === "annotate" && <AnnotateTab />}
        {tab === "advanced" && <Advanced />}
        {tab === "about" && <About />}
      </div>
    </div>
  );
}

// ------------------------------------------------------------ helpers

function useS<T = any>(key: string): [T, (v: T) => void] {
  const v = useSettings((s) => s.settings?.[key]) as T;
  const set = useSettings((s) => s.set);
  return [v, (nv: T) => set({ [key]: nv })];
}

function Row({ label, children, top }: { label?: ReactNode; children: ReactNode; top?: boolean }) {
  return (
    <div className={clsx("grid grid-cols-[190px_1fr] gap-x-4 py-[5px]", top ? "items-start" : "items-center")}>
      <div className={clsx("text-right text-[13px] text-[var(--text)]", top && "pt-[3px]")}>{label ? <>{label}:</> : null}</div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function Hint({ children }: { children: ReactNode }) {
  return <p className="text-[11.5px] text-[var(--text-2)] leading-snug mt-1 max-w-[440px]">{children}</p>;
}

function Divider() {
  return <div className="h-px bg-[var(--border)] my-4 ml-[206px]" />;
}

function Check({ k, label, hint, disabled }: { k: string; label: ReactNode; hint?: ReactNode; disabled?: boolean }) {
  const [v, set] = useS<boolean>(k);
  return <Checkbox checked={!!v} onChange={set} label={label} hint={hint} disabled={disabled} />;
}

// ------------------------------------------------------------ General

function AfterCaptureTable() {
  const s = useSettings((st) => st.settings)!;
  const set = useSettings((st) => st.set);
  const rows: { key: keyof AfterCapture; label: string; screenshot: boolean; recording: boolean }[] = [
    { key: "showQuickAccess", label: "Show Quick Access Overlay", screenshot: true, recording: true },
    { key: "copyToClipboard", label: "Copy file to clipboard", screenshot: true, recording: true },
    { key: "save", label: "Save to export location", screenshot: true, recording: true },
    { key: "openAnnotate", label: "Open Annotate tool", screenshot: true, recording: false },
    { key: "openVideoEditor", label: "Open Video Editor", screenshot: false, recording: true },
    { key: "pin", label: "Pin to the screen", screenshot: true, recording: false },
  ];
  const toggle = (which: "afterScreenshot" | "afterRecording", key: keyof AfterCapture) => {
    const cur = s[which] as AfterCapture;
    const next = { ...cur, [key]: !cur[key] };
    if (!Object.values(next).some(Boolean)) {
      alert("At least one action needs to be enabled.");
      return;
    }
    set({ [which]: next });
  };
  return (
    <div className="rounded-[8px] border border-[var(--border-strong)] overflow-hidden max-w-[420px] bg-[var(--panel)]">
      <div className="grid grid-cols-[1fr_84px_84px] text-[11.5px] font-medium text-[var(--text-2)] bg-[var(--win-bg-2)] border-b border-[var(--border)] px-3 py-1.5">
        <span>Action</span>
        <span className="text-center">Screenshot</span>
        <span className="text-center">Recording</span>
      </div>
      {rows.map((r, i) => (
        <div key={r.key} className={clsx("grid grid-cols-[1fr_84px_84px] items-center px-3 py-[5px] text-[12.5px]", i % 2 && "bg-[var(--win-bg-2)]/50")}>
          <span>{r.label}</span>
          <span className="flex justify-center">
            {r.screenshot && <Checkbox checked={!!s.afterScreenshot[r.key]} onChange={() => toggle("afterScreenshot", r.key)} label="" />}
          </span>
          <span className="flex justify-center">
            {r.recording && <Checkbox checked={!!s.afterRecording[r.key]} onChange={() => toggle("afterRecording", r.key)} label="" />}
          </span>
        </div>
      ))}
    </div>
  );
}

function General() {
  const [exportLoc, setExport] = useS<string>("exportLocation");
  const [sound, setSound] = useS<string>("shutterSound");
  const [clip, setClip] = useS<string>("clipboardContent");
  return (
    <div>
      <Row label="Startup">
        <Check k="launchAtLogin" label="Start at login" />
      </Row>
      <Row label="Sounds">
        <div className="flex items-center gap-3">
          <Check k="playSounds" label="Play sounds" />
          <Select
            value={sound}
            onChange={setSound}
            options={[
              { value: "classic", label: "Classic" },
              { value: "pop", label: "Pop" },
              { value: "subtle", label: "Subtle" },
              { value: "glass", label: "Glass" },
            ]}
            width={110}
          />
        </div>
      </Row>
      <Row label="Menu bar">
        <Check k="showMenuBarIcon" label="Show icon" hint="When hidden, launch Screenshot X again to open Settings." />
      </Row>
      <Row label="Dock">
        <Check k="showDockIcon" label="Show Dock icon" />
      </Row>
      <Row label="Desktop icons">
        <Check k="hideDesktopIconsWhileCapturing" label="Hide while capturing" />
      </Row>
      <Divider />
      <Row label="Export location">
        <div className="flex items-center gap-2">
          <span className="truncate max-w-[300px] text-[12.5px] px-2 py-[3px] rounded-[6px] bg-[var(--control)] border border-[var(--control-border)]" title={exportLoc}>
            {exportLoc?.replace(/^\/Users\/[^/]+/, "~")}
          </span>
          <Button
            small
            onClick={async () => {
              const p = await openDialog({ directory: true, defaultPath: exportLoc });
              if (typeof p === "string") setExport(p);
            }}
          >
            Choose…
          </Button>
          <Button small onClick={() => invoke("open_path", { path: exportLoc })}>
            Open
          </Button>
        </div>
      </Row>
      <Divider />
      <Row label="After capture" top>
        <AfterCaptureTable />
        <Hint>Decide what happens after taking a screenshot or recording your screen.</Hint>
      </Row>
      <Row label="Copy to clipboard">
        <Select
          value={clip}
          onChange={setClip}
          width={220}
          options={[
            { value: "fileAndImage", label: "File & Image (default)" },
            { value: "imageOnly", label: "Image only" },
            { value: "fileOnly", label: "File only" },
          ]}
        />
        <Hint>Adjust this if you encounter issues pasting into some apps or clipboard managers.</Hint>
      </Row>
      <Row label="File name">
        <Check k="askForNameAfterCapture" label="Ask for name after every capture" />
      </Row>
    </div>
  );
}

// ------------------------------------------------------------ Wallpaper

function WallpaperTab() {
  const [src, setSrc] = useS<string>("wallpaperSource");
  const [custom, setCustom] = useS<string>("customWallpaperPath");
  const [color, setColor] = useS<string>("wallpaperPlainColor");
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    invoke<string | null>("wallpaper_path", { blurred: false }).then((p) => setPreview(p ? `sx://localhost/file?p=${encodeURIComponent(p)}&t=${Date.now()}` : null));
  }, [src, custom, color]);
  return (
    <div>
      <p className="text-[12.5px] text-[var(--text-2)] mb-4 ml-[206px] max-w-[440px]">
        Choose the wallpaper used when you hide desktop icons, and behind window screenshots with the "With wallpaper" style.
      </p>
      <Row label="Wallpaper" top>
        <div className="space-y-1.5">
          <Radio checked={src === "desktop"} onChange={() => setSrc("desktop")} label="Desktop wallpaper" />
          <div className="flex items-center gap-2">
            <Radio checked={src === "custom"} onChange={() => setSrc("custom")} label="Custom wallpaper:" />
            <Button
              small
              onClick={async () => {
                const p = await openDialog({ filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "webp"] }] });
                if (typeof p === "string") {
                  setCustom(p);
                  setSrc("custom");
                }
              }}
            >
              Select an image…
            </Button>
            {custom && <span className="text-[11.5px] text-[var(--text-2)] truncate max-w-[180px]">{custom.split("/").pop()}</span>}
          </div>
          <div className="flex items-center gap-2">
            <Radio checked={src === "plainColor"} onChange={() => setSrc("plainColor")} label="Plain color:" />
            <input type="color" value={color} onChange={(e) => { setColor(e.target.value); setSrc("plainColor"); }} className="w-8 h-6 rounded border border-[var(--control-border)] bg-transparent" />
          </div>
        </div>
      </Row>
      <Row label="Preview" top>
        <div className="w-[320px] aspect-[16/10] rounded-[8px] overflow-hidden border border-[var(--border-strong)] bg-[var(--hover)]">
          {preview && <img src={preview} className="w-full h-full object-cover" />}
        </div>
      </Row>
      <Row label="Desktop icons">
        <div className="flex gap-2">
          <Button small onClick={() => invoke("run_action", { id: "hideDesktopIcons" })}>Hide Desktop Icons</Button>
          <Button small onClick={() => invoke("run_action", { id: "showDesktopIcons" })}>Show Desktop Icons</Button>
        </div>
      </Row>
    </div>
  );
}

function Radio({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: ReactNode }) {
  return (
    <label className="flex items-center gap-2 text-[13px]" onClick={onChange}>
      <span className={clsx("w-[15px] h-[15px] rounded-full flex items-center justify-center", checked ? "bg-[var(--accent)]" : "bg-[var(--control)] border border-[var(--control-border)]")}>
        {checked && <span className="w-[6px] h-[6px] rounded-full bg-white" />}
      </span>
      {label}
    </label>
  );
}

// ------------------------------------------------------------ Shortcuts

interface ActionInfo {
  id: string;
  label: string;
  group: string;
  shortcut: string;
}

const SYSTEM_DEFAULTS: Record<string, string> = {
  captureFullscreen: "Shift+Super+Digit3",
  captureArea: "Shift+Super+Digit4",
  allInOne: "Shift+Super+Digit5",
  captureText: "Shift+Super+Digit2",
  recordScreen: "Shift+Super+Digit6",
};

function Shortcuts() {
  const [actions, setActions] = useState<ActionInfo[]>([]);
  const shortcuts = useSettings((s) => s.settings?.shortcuts ?? {});
  const set = useSettings((s) => s.set);
  useEffect(() => {
    invoke<ActionInfo[]>("get_actions").then((a) => a && setActions(a));
  }, []);
  const groups = useMemo(() => Array.from(new Set(actions.map((a) => a.group))), [actions]);
  const setShortcut = (id: string, acc: string) => {
    const next: Record<string, string> = { ...shortcuts };
    // a shortcut can only be bound to one action
    if (acc) for (const k of Object.keys(next)) if (next[k] === acc) next[k] = "";
    next[id] = acc;
    set({ shortcuts: next });
  };
  return (
    <div className="max-w-[560px] mx-auto">
      {groups.map((g) => (
        <div key={g} className="mb-5">
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-2)] mb-1.5">{g}</div>
          <div className="rounded-[8px] border border-[var(--border-strong)] bg-[var(--panel)] divide-y divide-[var(--border)]">
            {actions
              .filter((a) => a.group === g)
              .map((a) => (
                <div key={a.id} className="flex items-center justify-between px-3 py-[7px]">
                  <span className="text-[13px]">{a.label}</span>
                  <ShortcutRecorder value={shortcuts[a.id] ?? ""} onChange={(acc) => setShortcut(a.id, acc)} />
                </div>
              ))}
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2 mb-3">
        <Button
          onClick={() => {
            set({ shortcuts: { ...shortcuts, ...SYSTEM_DEFAULTS } });
          }}
        >
          Use System Default Shortcuts…
        </Button>
        <Button onClick={() => invoke("open_url", { url: "x-apple.systempreferences:com.apple.Keyboard-Settings.extension" })}>Open Keyboard Settings</Button>
      </div>
      <Hint>
        To use ⇧⌘3, ⇧⌘4 and ⇧⌘5, first disable the macOS screenshot shortcuts: System Settings → Keyboard → Keyboard Shortcuts… → Screenshots.
      </Hint>
      <div className="mt-4">
        <Check k="ignoreAfterCaptureForSpecificShortcuts" label={<>Ignore "After capture" actions when using "Capture Area &amp; …" shortcuts</>} />
      </div>
    </div>
  );
}

// ------------------------------------------------------------ Quick Access

function QuickAccessTab() {
  const [pos, setPos] = useS<string>("qaPosition");
  const [size, setSize] = useS<number>("qaSize");
  const [autoClose] = useS<boolean>("qaAutoClose");
  const [interval, setIntervalS] = useS<number>("qaAutoCloseInterval");
  const [action, setAction] = useS<string>("qaAutoCloseAction");
  return (
    <div>
      <Row label="Position on screen">
        <Segmented value={pos} onChange={setPos} options={[{ value: "left", label: "Left" }, { value: "right", label: "Right" }]} />
      </Row>
      <Row label="Overlay size">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-2)]">Min</span>
          <Slider value={size} min={0.6} max={1.6} step={0.05} onChange={setSize} width={180} />
          <span className="text-[11px] text-[var(--text-2)]">Max</span>
        </div>
      </Row>
      <Row label="Multi-display">
        <Check k="qaMoveToActiveScreen" label="Move to active screen" hint="The active screen is the one where your cursor is." />
      </Row>
      <Divider />
      <Row label="Auto-close">
        <div className="flex items-center gap-2 flex-wrap">
          <Check k="qaAutoClose" label="Enable" />
          <Select
            value={action}
            onChange={setAction}
            width={140}
            options={[
              { value: "close", label: "Close" },
              { value: "saveAndClose", label: "Save and Close" },
            ]}
          />
          <span className="text-[12.5px]">after</span>
          <Select
            value={interval}
            onChange={setIntervalS}
            width={110}
            options={[5, 10, 15, 30, 60, 120, 300].map((s) => ({ value: s, label: s < 60 ? `${s} seconds` : `${s / 60} minute${s > 60 ? "s" : ""}` }))}
          />
        </div>
        {autoClose && <Hint>The timer pauses while you hover the overlay.</Hint>}
      </Row>
      <Row label="Drag & drop">
        <Check k="qaCloseAfterDragging" label="Close after dragging" />
      </Row>
      <Row label="File info">
        <Check k="qaShowFileInfo" label="Show dimensions and file size on hover" />
      </Row>
      <Divider />
      <Row label="Tips" top>
        <ul className="text-[12px] text-[var(--text-2)] space-y-1 list-disc pl-4 max-w-[440px]">
          <li>Double-click a thumbnail to open Annotate (or the Video Editor).</li>
          <li>Swipe a thumbnail towards the screen edge with two fingers to dismiss it.</li>
          <li>Drag & drop thumbnails into any app.</li>
          <li>Press Space on a hovered thumbnail for Quick Look; right-click for more actions.</li>
          <li>"Restore Last Capture" in the menu bar brings back closed overlays.</li>
        </ul>
      </Row>
    </div>
  );
}

// ------------------------------------------------------------ Recording

function Recording() {
  const s = useSettings((st) => st.settings)!;
  const set = useSettings((st) => st.set);
  return (
    <div>
      <SectionTitle>General</SectionTitle>
      <Row label="Recording" top>
        <div className="space-y-0.5">
          <div className="flex items-center gap-2">
            <Check k="recShowCountdown" label="Show countdown" />
            <Select value={s.recCountdownSeconds} onChange={(v) => set({ recCountdownSeconds: v })} width={70} options={[1, 2, 3, 5, 10].map((n) => ({ value: n, label: `${n}s` }))} />
          </div>
          <Check k="recShowCursor" label="Show cursor" />
          <Check k="recDoNotDisturb" label={'"Do Not Disturb" while recording'} hint="Uses a Shortcuts automation named “Screenshot X DND On/Off” if present." />
          <Check k="recDimScreen" label="Dim screen while recording" />
          <Check k="recHideDesktopIcons" label="Hide desktop icons while recording" />
          <Check k="recRememberLastSelection" label="Remember last selection" />
          <Check k="recOpenEditorAfter" label="Open Video Editor after recording" />
        </div>
      </Row>
      <Row label="Menu bar">
        <Check k="recDisplayTimeInMenuBar" label="Display recording time" />
      </Row>
      <Row label="Controls">
        <Check k="recShowControls" label="Show controls while recording" />
      </Row>
      <Divider />
      <Row label="Clicks" top>
        <Check k="recHighlightClicks" label="Highlight clicks" />
        <div className="flex items-center gap-3 mt-1.5 ml-6">
          <Segmented size="sm" value={s.recClickStyle} onChange={(v) => set({ recClickStyle: v })} options={[{ value: "filled", label: "Filled" }, { value: "outline", label: "Outline" }]} />
          <label className="flex items-center gap-1.5 text-[12px]">
            Color
            <input type="color" value={s.recClickColor || "#0a84ff"} onChange={(e) => set({ recClickColor: e.target.value })} className="w-7 h-5 rounded border border-[var(--control-border)]" />
            <button className="text-[11px] text-[var(--accent)]" onClick={() => set({ recClickColor: "" })}>
              System accent
            </button>
          </label>
        </div>
        <div className="flex items-center gap-3 mt-1.5 ml-6">
          <span className="text-[12px]">Size</span>
          <Slider value={s.recClickSize} min={0.5} max={2} step={0.1} onChange={(v) => set({ recClickSize: v })} width={120} />
          <Check k="recClickAnimate" label="Animate clicks" />
        </div>
      </Row>
      <Row label="Keystrokes" top>
        <Check k="recShowKeystrokes" label="Show keystrokes" hint="Requires Accessibility permission. Keystrokes typed in password fields are never shown." />
        <div className="flex items-center gap-3 mt-1.5 ml-6 flex-wrap">
          <Segmented size="sm" value={s.recKeystrokeStyle} onChange={(v) => set({ recKeystrokeStyle: v })} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          <Select
            value={s.recKeystrokePosition}
            onChange={(v) => set({ recKeystrokePosition: v })}
            width={130}
            options={[
              { value: "bottomCenter", label: "Bottom center" },
              { value: "bottomLeft", label: "Bottom left" },
              { value: "bottomRight", label: "Bottom right" },
              { value: "topCenter", label: "Top center" },
            ]}
          />
          <Select value={s.recKeystrokeSize} onChange={(v) => set({ recKeystrokeSize: v })} width={90} options={[{ value: 0.8, label: "Small" }, { value: 1, label: "Medium" }, { value: 1.3, label: "Large" }]} />
        </div>
        <div className="mt-1.5 ml-6">
          <Segmented size="sm" value={s.recKeystrokeOnlyCommandKeys ? "cmd" : "all"} onChange={(v) => set({ recKeystrokeOnlyCommandKeys: v === "cmd" })} options={[{ value: "all", label: "Show all keys" }, { value: "cmd", label: "Only command keys" }]} />
        </div>
        <div className="mt-2 ml-6">
          <Button small onClick={() => invoke("request_permission", { kind: "accessibility" })}>Grant Accessibility…</Button>
        </div>
      </Row>
      <Row label="Camera" top>
        <div className="flex items-center gap-3 flex-wrap">
          <Segmented size="sm" value={s.recCameraShape} onChange={(v) => set({ recCameraShape: v })} options={[{ value: "circle", label: "Circle" }, { value: "roundedRect", label: "Rounded" }, { value: "square", label: "Square" }]} />
          <Segmented size="sm" value={s.recCameraSize} onChange={(v) => set({ recCameraSize: v })} options={[{ value: "small", label: "S" }, { value: "medium", label: "M" }, { value: "large", label: "L" }]} />
          <Check k="recCameraFlip" label="Mirror" />
        </div>
        <Hint>Click the camera bubble while recording to toggle full screen.</Hint>
      </Row>
      <SectionTitle>Video</SectionTitle>
      <Row label="Video FPS">
        <Segmented value={s.recVideoFps} onChange={(v) => set({ recVideoFps: v })} options={[24, 30, 60].map((f) => ({ value: f, label: String(f) }))} />
      </Row>
      <Row label="Video encoder">
        <Segmented value={s.recVideoEncoder} onChange={(v) => set({ recVideoEncoder: v })} options={[{ value: "h264", label: "H.264" }, { value: "hevc", label: "HEVC (H.265)" }]} />
      </Row>
      <Row label="Max resolution">
        <Select
          value={s.recMaxResolution}
          onChange={(v) => set({ recMaxResolution: v })}
          width={160}
          options={[
            { value: 0, label: "Original" },
            { value: 2160, label: "4K (2160p)" },
            { value: 1440, label: "1440p" },
            { value: 1080, label: "1080p" },
            { value: 720, label: "720p" },
          ]}
        />
        <Hint>Set a maximum resolution to reduce file size and upload time.</Hint>
      </Row>
      <Row label="Retina">
        <Check k="recScaleRetina" label="Scale Retina videos to 1x" />
      </Row>
      <Row label="Audio" top>
        <Check k="recAudioMono" label="Record audio in mono" />
        <Segmented
          size="sm"
          value={s.recSeparateAudioTracks ? "separate" : "single"}
          onChange={(v) => set({ recSeparateAudioTracks: v === "separate" })}
          options={[{ value: "single", label: "Record on a single track" }, { value: "separate", label: "Record on separate tracks" }]}
        />
        <Hint>Separate tracks let you edit the microphone and the computer audio independently in a video editor.</Hint>
      </Row>
      <SectionTitle>GIF</SectionTitle>
      <Row label="GIF FPS">
        <Segmented value={s.recGifFps} onChange={(v) => set({ recGifFps: v })} options={[10, 15, 20, 30].map((f) => ({ value: f, label: String(f) }))} />
      </Row>
      <Row label="GIF size">
        <Select
          value={s.recGifMaxWidth}
          onChange={(v) => set({ recGifMaxWidth: v })}
          width={190}
          options={[
            { value: 0, label: "Original" },
            { value: 1280, label: "1280 × auto" },
            { value: 1024, label: "1024 × auto" },
            { value: 800, label: "800 × auto (default)" },
            { value: 640, label: "640 × auto" },
            { value: 480, label: "480 × auto" },
          ]}
        />
        <Hint>GIFs are only downscaled when needed.</Hint>
      </Row>
      <Row label="GIF quality">
        <div className="flex items-center gap-2">
          <span className="text-[11px] text-[var(--text-2)]">Low</span>
          <Slider value={s.recGifQuality} min={20} max={100} onChange={(v) => set({ recGifQuality: v })} width={180} />
          <span className="text-[11px] text-[var(--text-2)]">High</span>
        </div>
      </Row>
      <Row label="Optimization">
        <Check k="recGifOptimize" label="Optimize GIFs" hint="Smaller files at the cost of a longer processing time." />
      </Row>
    </div>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <div className="ml-[206px] mt-5 mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-[var(--text-2)] first:mt-0">{children}</div>;
}

// ------------------------------------------------------------ Screenshots

function Screenshots() {
  const s = useSettings((st) => st.settings)!;
  const set = useSettings((st) => st.set);
  const [langs, setLangs] = useState<string[]>([]);
  useEffect(() => {
    invoke<string[]>("ocr_languages").then((l) => l && setLangs(l));
  }, []);
  const presets: { id: string; name: string }[] = s.backgroundPresets ?? [];
  return (
    <div>
      <Row label="File format">
        <div className="flex items-center gap-3">
          <Segmented
            value={s.screenshotFormat}
            onChange={(v) => set({ screenshotFormat: v })}
            options={[{ value: "png", label: "PNG" }, { value: "jpg", label: "JPEG" }, { value: "heic", label: "HEIC" }, { value: "webp", label: "WebP" }]}
          />
          {(s.screenshotFormat === "jpg" || s.screenshotFormat === "heic") && (
            <span className="flex items-center gap-1.5 text-[12px]">
              Quality <NumberField value={s.jpegQuality} min={10} max={100} width={44} onChange={(v) => set({ jpegQuality: v })} suffix="%" />
            </span>
          )}
        </div>
      </Row>
      <Row label="Retina" top>
        <Check k="scaleRetinaTo1x" label="Scale Retina screenshots to 1x" hint="It will decrease the quality of your screenshots." />
        <Check k="addRetinaSuffix" label={'Add "@2x" suffix to Retina screenshots'} hint="Improves compatibility with displaying Retina screenshots in third-party apps." />
      </Row>
      <Row label="Border">
        <Check k="addBorder" label="Add 1px border to all screenshots" />
      </Row>
      <Row label="Cursor">
        <Check k="captureCursor" label="Show cursor on screenshots" hint="Works in Fullscreen, Previous Area and Self-Timer modes." />
      </Row>
      <Divider />
      <Row label="Window screenshot" top>
        <Segmented
          value={s.windowBackground}
          onChange={(v) => set({ windowBackground: v })}
          options={[{ value: "wallpaper", label: "With wallpaper" }, { value: "transparent", label: "Transparent" }, { value: "plainColor", label: "Plain color" }]}
        />
        {s.windowBackground !== "transparent" && (
          <div className="flex items-center gap-3 mt-2">
            {s.windowBackground === "plainColor" && <input type="color" value={s.windowBgColor} onChange={(e) => set({ windowBgColor: e.target.value })} className="w-8 h-6 rounded border border-[var(--control-border)]" />}
            <span className="text-[12px]">Padding</span>
            <Slider value={s.windowPadding} min={0} max={200} onChange={(v) => set({ windowPadding: v })} width={140} />
            <span className="text-[11.5px] tabular-nums text-[var(--text-2)]">{s.windowPadding}pt</span>
          </div>
        )}
        <div className="mt-2">
          <Check k="captureWindowShadow" label="Capture window shadow" hint="Hold ⌥ (Option) while clicking a window to capture it without shadow." />
        </div>
      </Row>
      <Divider />
      <Row label="Freeze screen">
        <Check k="freezeScreen" label="Freeze screen when taking a screenshot" hint="Capture menus, tooltips and other moving content." />
      </Row>
      <Row label="Crosshair mode">
        <Select
          value={s.crosshairMode}
          onChange={(v) => set({ crosshairMode: v })}
          width={200}
          options={[
            { value: "always", label: "Always enabled" },
            { value: "whenCommandPressed", label: "When ⌘ Command is pressed" },
            { value: "disabled", label: "Disabled" },
          ]}
        />
      </Row>
      <Row label="Magnifier">
        <Check k="showMagnifier" label="Show magnifier" />
      </Row>
      <Row label="All-In-One">
        <Check k="rememberLastSelection" label="Remember last selection" />
      </Row>
      <Row label="Self-Timer interval">
        <Select value={s.selfTimerSeconds} onChange={(v) => set({ selfTimerSeconds: v })} width={100} options={[3, 5, 10, 15, 30].map((n) => ({ value: n, label: `${n} seconds` }))} />
      </Row>
      <Divider />
      <Row label="Background Tool" top>
        <div className="flex items-center gap-2">
          <Check k="autoApplyBackgroundPreset" label="Automatically apply preset:" disabled={!presets.length} />
          <Select
            value={s.autoBackgroundPresetId || ""}
            onChange={(v) => set({ autoBackgroundPresetId: v, autoApplyBackgroundPreset: !!v })}
            width={160}
            options={[{ value: "", label: presets.length ? "Choose preset" : "No presets yet" }, ...presets.map((p) => ({ value: p.id, label: p.name }))]}
          />
        </div>
        <Hint>Create presets in Annotate → Background Tool.</Hint>
      </Row>
      <Divider />
      <Row label="Text recognition" top>
        <Check k="ocrKeepLineBreaks" label="Keep line breaks" />
        <Check k="ocrDetectLinks" label="Detect links" />
        <div className="flex items-center gap-2 mt-1">
          <span className="text-[12.5px]">Primary language</span>
          <Select value={s.ocrLanguage} onChange={(v) => set({ ocrLanguage: v })} width={180} options={[{ value: "auto", label: "Automatic" }, ...langs.map((l) => ({ value: l, label: l }))]} />
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span className="text-[12.5px]">Links</span>
          <Select value={s.ocrOpenLinks} onChange={(v) => set({ ocrOpenLinks: v })} width={180} options={[{ value: "ask", label: "Ask to open" }, { value: "always", label: "Always open" }, { value: "never", label: "Never open links" }]} />
        </div>
      </Row>
    </div>
  );
}

// ------------------------------------------------------------ Annotate

function AnnotateTab() {
  const [save, setSave] = useS<string>("annotateSaveBehavior");
  return (
    <div>
      <Row label="Arrow tool">
        <Check k="annotateInverseArrow" label="Inverse arrow direction" hint="Press ⌥ (Option) while drawing to invert the behavior." />
      </Row>
      <Row label="Pencil tool">
        <Check k="annotateSmoothDrawing" label="Smooth drawing" />
      </Row>
      <Row label="Background tool">
        <Check k="annotateRememberBackgroundTool" label="Remember if tool was opened" />
      </Row>
      <Row label="Objects">
        <Check k="annotateDrawShadow" label="Draw shadow on objects" />
      </Row>
      <Row label="Colors">
        <Check k="annotateShowColorNames" label="Show color names" />
      </Row>
      <Row label="Window">
        <Check k="annotateAlwaysOnTop" label="Always on top" />
      </Row>
      <Divider />
      <Row label="Save button behavior">
        <Select value={save} onChange={setSave} width={220} options={[{ value: "exportLocation", label: 'Save to "Export location"' }, { value: "ask", label: "Ask for destination" }]} />
      </Row>
      <Row label="Copy button">
        <Check k="annotateCopyAndClose" label="Close the window after copying" />
      </Row>
    </div>
  );
}

// ------------------------------------------------------------ Advanced

const TOKENS: [string, string][] = [
  ["{YYYY}", "Year"], ["{MM}", "Month (numeric)"], ["{MMMM}", "Month (name)"], ["{DD}", "Day"], ["{dddd}", "Day of week"],
  ["{HH}", "Hour"], ["{hh}", "Hour (12h)"], ["{mm}", "Minutes"], ["{ss}", "Seconds"], ["{A}", "AM/PM"],
  ["{app}", "App name"], ["{window}", "Window title"], ["{random}", "Random characters"], ["{counter}", "Number"], ["{type}", "Capture type"],
];

function previewName(p: string) {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const map: Record<string, string> = {
    "{YYYY}": String(d.getFullYear()), "{YY}": String(d.getFullYear()).slice(2), "{MM}": pad(d.getMonth() + 1),
    "{MMMM}": d.toLocaleString("en", { month: "long" }), "{MMM}": d.toLocaleString("en", { month: "short" }), "{DD}": pad(d.getDate()),
    "{dddd}": d.toLocaleString("en", { weekday: "long" }), "{ddd}": d.toLocaleString("en", { weekday: "short" }), "{HH}": pad(d.getHours()),
    "{hh}": pad(d.getHours() % 12 || 12), "{mm}": pad(d.getMinutes()), "{ss}": pad(d.getSeconds()), "{A}": d.getHours() < 12 ? "AM" : "PM",
    "{app}": "Safari", "{window}": "Apple", "{random}": "a8Kq2Z", "{counter}": "1", "{type}": "Screenshot",
  };
  return p.replace(/\{[A-Za-z]+\}/g, (t) => map[t] ?? t);
}

function Advanced() {
  const [pattern, setPattern] = useS<string>("fileNamePattern");
  const [draft, setDraft] = useState(pattern);
  const [counter, setCounter] = useS<number>("autoIncrement");
  const [days, setDays] = useS<number>("historyDays");
  const [allow, setAllow] = useS<boolean | null>("allowUrlScheme");
  const [perm, setPerm] = useState<{ screen: boolean; accessibility: boolean } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => setDraft(pattern), [pattern]);
  useEffect(() => {
    invoke("permissions_status").then(setPerm);
  }, []);
  const insert = (t: string) => {
    const el = inputRef.current;
    const pos = el?.selectionStart ?? draft.length;
    const next = draft.slice(0, pos) + t + draft.slice(pos);
    setDraft(next);
    setPattern(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(pos + t.length, pos + t.length);
    });
  };
  return (
    <div>
      <Row label="File name" top>
        <input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => setPattern(draft || "Screenshot X {YYYY}-{MM}-{DD} at {HH}.{mm}.{ss}")}
          className="w-full max-w-[440px] h-[26px] rounded-[6px] px-2 text-[12.5px] font-mono bg-[var(--control)] border border-[var(--control-border)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_45%,transparent)]"
        />
        <div className="text-[11.5px] text-[var(--text-2)] mt-1">
          Preview: <span className="text-[var(--text)]">{previewName(draft)}.png</span>
        </div>
        <div className="flex flex-wrap gap-1 mt-2 max-w-[460px]">
          {TOKENS.map(([t, l]) => (
            <button key={t} onClick={() => insert(t)} className="h-[22px] px-2 rounded-full text-[11.5px] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-[var(--accent)] hover:brightness-110">
              {l}
            </button>
          ))}
        </div>
        <div className="mt-2 space-y-0.5">
          <Check k="useUtc" label="Use UTC time zone" />
          <Check k="removeIllegalChars" label="Remove illegal characters" />
          <div className="flex items-center gap-2 text-[12.5px]">
            Auto-increment next number: <NumberField value={counter} min={1} max={999999} width={70} onChange={setCounter} />
          </div>
        </div>
      </Row>
      <Divider />
      <Row label="Pinned screenshots" top>
        <Check k="pinsShowOnScreenshots" label="Show on screenshots" />
        <Check k="pinsHideOnHoverWhenLocked" label="Fade locked pins on mouse over" hint="Hold ⌥ over a locked pin to interact with it." />
        <Check k="pinsShadow" label="Shadow" />
      </Row>
      <Row label="Capture history">
        <div className="flex items-center gap-2">
          <Select
            value={days}
            onChange={setDays}
            width={140}
            options={[
              { value: 0, label: "Never" },
              { value: 1, label: "1 day" },
              { value: 7, label: "1 week" },
              { value: 30, label: "1 month" },
              { value: 90, label: "3 months" },
            ]}
          />
          <Button small onClick={() => invoke("cmd_open_history")}>
            Open History
          </Button>
        </div>
        <Hint>Restore old files with "Capture History" from the menu bar.</Hint>
      </Row>
      <Row label="URL scheme">
        <Checkbox checked={allow === true} onChange={(v) => setAllow(v)} label="Allow applications to control Screenshot X" hint={<>Automate captures with <code>screenshotx://</code> links (e.g. from Raycast, Alfred or Shortcuts).</>} />
      </Row>
      <Row label="Dialogs">
        <Button small onClick={() => invoke("reset_warnings")}>Reset All Warning Dialogs</Button>
      </Row>
      <Divider />
      <Row label="Permissions" top>
        <div className="space-y-1.5 text-[12.5px]">
          <PermRow ok={perm?.screen} label="Screen & System Audio Recording" onFix={() => invoke("request_permission", { kind: "screen" })} />
          <PermRow ok={perm?.accessibility} label="Accessibility (keystrokes)" onFix={() => invoke("request_permission", { kind: "accessibility" })} />
          <PermRow ok={undefined} label="Camera & Microphone" onFix={() => invoke("request_permission", { kind: "camera" })} />
        </div>
      </Row>
    </div>
  );
}

function PermRow({ ok, label, onFix }: { ok?: boolean; label: string; onFix: () => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className={clsx("w-2 h-2 rounded-full", ok === undefined ? "bg-[var(--text-3)]" : ok ? "bg-[#34c759]" : "bg-[#ff3b30]")} />
      <span className="w-[230px]">{label}</span>
      <Button small onClick={onFix}>
        {ok ? "Open Settings" : "Grant…"}
      </Button>
    </div>
  );
}

// ------------------------------------------------------------ About

function About() {
  const [version, setVersion] = useState("");
  useEffect(() => {
    invoke<string>("app_version").then((v) => setVersion(v ?? "dev"));
  }, []);
  return (
    <div className="flex flex-col items-center text-center pt-6">
      <img src={appIcon} className="w-28 h-28 mb-2" draggable={false} />
      <div className="text-[20px] font-semibold">Screenshot X</div>
      <div className="text-[12.5px] text-[var(--text-2)] mt-1">Version {version}</div>
      <p className="text-[12.5px] text-[var(--text-2)] mt-4 max-w-[420px] leading-relaxed">
        Screenshots, recordings, annotations, OCR, scrolling capture and pins — all local, all yours.
      </p>
      <div className="flex gap-2 mt-5">
        <Button onClick={() => invoke("open_path", { path: `${"~"}/Library/Logs/Screenshot X` })}>Open Logs</Button>
        <Button onClick={() => invoke("cmd_open_history")}>Capture History</Button>
        <Button onClick={() => invoke("quit")}>Quit Screenshot X</Button>
      </div>
      <div className="mt-8 text-left text-[12px] text-[var(--text-2)] max-w-[480px] w-full">
        <div className="font-semibold text-[var(--text)] mb-1.5">URL scheme</div>
        <code className="block whitespace-pre leading-relaxed text-[11.5px] bg-[var(--panel)] border border-[var(--border)] rounded-lg p-3 overflow-x-auto">
          {`screenshotx://capture-area?action=copy
screenshotx://capture-fullscreen
screenshotx://all-in-one
screenshotx://scrolling-capture?autoscroll=true
screenshotx://record-screen
screenshotx://capture-text?linebreaks=false
screenshotx://pin?filepath=~/Desktop/image.png
screenshotx://open-annotate?filepath=…
screenshotx://open-settings?tab=shortcuts`}
        </code>
      </div>
    </div>
  );
}
