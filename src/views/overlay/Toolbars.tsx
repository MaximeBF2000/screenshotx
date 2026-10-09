import { useEffect, useState, type ReactNode } from "react";
import {
  AppWindow,
  Camera,
  ChevronDown,
  Image as ImageIcon,
  Mic,
  MicOff,
  Monitor,
  MousePointer2,
  ScanText,
  ScrollText,
  Settings2,
  Timer,
  Video,
  Volume2,
  VolumeX,
  Webcam,
  X,
  Ratio,
  Play,
  ArrowDownToLine,
} from "lucide-react";
import clsx from "clsx";
import { invoke, type OverlayPayload } from "../../lib/ipc";
import { popupMenu, type MenuEntry } from "../../lib/menu";
import { RATIOS, SIZE_PRESETS, type Rect } from "./geometry";

function placement(sel: Rect, W: number, H: number, width: number) {
  const h = 46;
  let top = sel.y + sel.h + 12;
  if (top + h > H - 8) top = sel.y - h - 12;
  if (top < 8) top = sel.y + sel.h - h - 12;
  let left = sel.x + sel.w / 2 - width / 2;
  left = Math.max(8, Math.min(W - width - 8, left));
  return { left, top };
}

export function Btn({
  icon,
  label,
  onClick,
  active,
  danger,
  wide,
  children,
  onMenu,
}: {
  icon?: ReactNode;
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  active?: boolean;
  danger?: boolean;
  wide?: boolean;
  children?: ReactNode;
  onMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div className="flex items-center">
      <button
        title={label}
        onClick={onClick}
        className={clsx(
          "h-8 flex items-center justify-center gap-1.5 rounded-lg text-[12.5px] font-medium transition-colors",
          wide ? "px-3" : "w-8",
          danger
            ? "bg-[#ff3b30] hover:bg-[#ff5147] text-white px-3"
            : active
              ? "bg-white/22 text-white"
              : "text-white/85 hover:bg-white/12",
          onMenu && "rounded-r-none",
        )}
      >
        {icon}
        {children}
      </button>
      {onMenu && (
        <button onClick={onMenu} className={clsx("h-8 w-4 flex items-center justify-center rounded-r-lg text-white/70 hover:bg-white/12", active && "bg-white/22")}>
          <ChevronDown size={11} />
        </button>
      )}
    </div>
  );
}

const Sep = () => <div className="w-px h-5 bg-white/15 mx-1" />;

function SizeInputs({ sel, setSel, ratio, setRatio, W, H }: { sel: Rect; setSel: (r: Rect) => void; ratio: number | null; setRatio: (r: number | null) => void; W: number; H: number }) {
  const [w, setW] = useState(String(Math.round(sel.w)));
  const [h, setH] = useState(String(Math.round(sel.h)));
  const [focus, setFocus] = useState(false);
  useEffect(() => {
    if (!focus) {
      setW(String(Math.round(sel.w)));
      setH(String(Math.round(sel.h)));
    }
  }, [sel.w, sel.h, focus]);
  const apply = (nw: number, nh: number) => {
    if (!(nw > 0 && nh > 0)) return;
    setSel({ x: Math.min(sel.x, W - nw), y: Math.min(sel.y, H - nh), w: Math.min(nw, W), h: Math.min(nh, H) });
  };
  const input = "w-[52px] h-7 rounded-md bg-white/10 text-white text-center text-[12px] tabular-nums outline-none focus:bg-white/18 focus:ring-1 focus:ring-[var(--accent)]";
  const ratioMenu = (e: React.MouseEvent) => {
    const entries: MenuEntry[] = [
      ...RATIOS.map((r) => ({
        label: r.label,
        checked: ratio === r.value,
        action: () => {
          setRatio(r.value);
          if (r.value) apply(sel.w, sel.w / r.value);
        },
      })),
      "separator",
      { label: "Size Presets", items: SIZE_PRESETS.map((s) => ({ label: s.label, action: () => apply(s.w, s.h) })) },
    ];
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(entries, { x: b.left, y: b.bottom + 4 });
  };
  return (
    <div className="flex items-center gap-1 px-1">
      <input
        className={input}
        value={w}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          const nw = Number(w);
          apply(nw, ratio ? nw / ratio : sel.h);
        }}
        onChange={(e) => setW(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <span className="text-white/50 text-[11px]">×</span>
      <input
        className={input}
        value={h}
        onFocus={() => setFocus(true)}
        onBlur={() => {
          setFocus(false);
          const nh = Number(h);
          apply(ratio ? nh * ratio : sel.w, nh);
        }}
        onChange={(e) => setH(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <Btn icon={<Ratio size={15} />} label="Aspect ratio & size presets" active={!!ratio} onClick={ratioMenu} />
    </div>
  );
}

interface AioProps {
  sel: Rect;
  W: number;
  H: number;
  ratio: number | null;
  setRatio: (r: number | null) => void;
  setSel: (r: Rect) => void;
  commit: (kind: string, extra?: Record<string, any>) => void;
  cancel: () => void;
  toWindow: () => void;
  toRecord: (kind: "video" | "gif") => void;
}

export function AioToolbar({ sel, W, H, ratio, setRatio, setSel, commit, cancel, toWindow, toRecord }: AioProps) {
  const width = 640;
  const pos = placement(sel, W, H, width);
  return (
    <div
      data-toolbar
      className="absolute hud rounded-[13px] p-1.5 flex items-center shadow-2xl"
      style={{ ...pos, animation: "pop-in .16s ease-out" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <SizeInputs sel={sel} setSel={setSel} ratio={ratio} setRatio={setRatio} W={W} H={H} />
      <Sep />
      <Btn icon={<Camera size={16} />} label="Capture Area (↩)" onClick={() => commit("area")} />
      <Btn icon={<AppWindow size={16} />} label="Capture Window (Space)" onClick={toWindow} />
      <Btn icon={<Monitor size={16} />} label="Capture Fullscreen" onClick={() => commit("fullscreen", { rect: { x: 0, y: 0, w: W, h: H } })} />
      <Btn icon={<Timer size={16} />} label="Self-Timer" onClick={() => commit("selftimer")} />
      <Btn icon={<ScrollText size={16} />} label="Scrolling Capture" onClick={() => commit("scroll")} />
      <Btn icon={<ScanText size={16} />} label="Capture Text (OCR)" onClick={() => commit("ocr")} />
      <Sep />
      <Btn icon={<Video size={16} />} label="Record Video…" onClick={() => toRecord("video")} />
      <Btn icon={<span className="text-[10px] font-bold tracking-tight">GIF</span>} label="Record GIF…" onClick={() => toRecord("gif")} />
      <Sep />
      <Btn icon={<X size={16} />} label="Cancel (Esc)" onClick={cancel} />
    </div>
  );
}

interface Device {
  id: string;
  name: string;
}

export function RecordToolbar({ p, initialKind, pickedWindow, sel, W, H, ratio, setRatio, setSel, commit, cancel }: { p: OverlayPayload; initialKind: "video" | "gif"; pickedWindow: number | null } & Omit<AioProps, "toWindow" | "toRecord">) {
  const [kind, setKind] = useState<"video" | "gif">(initialKind);
  const [opts, setOpts] = useState<Record<string, any>>(p.settings);
  const [devices, setDevices] = useState<{ microphones: Device[]; cameras: Device[] }>({ microphones: [], cameras: [] });
  useEffect(() => {
    invoke<{ microphones: Device[]; cameras: Device[] }>("media_devices").then((d) => d && setDevices(d));
  }, []);
  const set = (k: string, v: any) => {
    setOpts((o) => ({ ...o, [k]: v }));
    invoke("set_settings", { patch: { [k]: v } });
  };
  const width = 760;
  const pos = placement(sel, W, H, width);
  const gif = kind === "gif";
  const micName = (devices.microphones.find((d) => d.id === opts.recMicrophone) ?? devices.microphones[0])?.name?.replace(/ Microphone$/, "") ?? "Microphone";

  const micMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(
      [
        { label: "Do Not Record Microphone", checked: !opts.recRecordMicrophone, action: () => set("recRecordMicrophone", false) },
        "separator",
        ...devices.microphones.map((d) => ({
          label: d.name,
          checked: opts.recRecordMicrophone && (opts.recMicrophone === d.id || (!opts.recMicrophone && d === devices.microphones[0])),
          action: () => {
            set("recMicrophone", d.id);
            set("recRecordMicrophone", true);
          },
        })),
      ],
      { x: b.left, y: b.bottom + 4 },
    );
  };
  const camMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(
      [
        { label: "Don't Record Camera", checked: !opts.recRecordCamera, action: () => set("recRecordCamera", false) },
        "separator",
        ...devices.cameras.map((d) => ({
          label: d.name,
          checked: opts.recRecordCamera && (opts.recCamera === d.id || (!opts.recCamera && d === devices.cameras[0])),
          action: () => {
            set("recCamera", d.id);
            set("recRecordCamera", true);
          },
        })),
      ],
      { x: b.left, y: b.bottom + 4 },
    );
  };
  const optionsMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(
      [
        { label: "Show Cursor", checked: !!opts.recShowCursor, action: () => set("recShowCursor", !opts.recShowCursor) },
        { label: "Highlight Clicks", checked: !!opts.recHighlightClicks, action: () => set("recHighlightClicks", !opts.recHighlightClicks) },
        { label: "Show Keystrokes", checked: !!opts.recShowKeystrokes, action: () => set("recShowKeystrokes", !opts.recShowKeystrokes) },
        "separator",
        { label: "Dim Screen While Recording", checked: !!opts.recDimScreen, action: () => set("recDimScreen", !opts.recDimScreen) },
        { label: "“Do Not Disturb” While Recording", checked: !!opts.recDoNotDisturb, action: () => set("recDoNotDisturb", !opts.recDoNotDisturb) },
        "separator",
        {
          label: "Video FPS",
          items: [24, 30, 60].map((f) => ({ label: `${f} FPS`, checked: opts.recVideoFps === f, action: () => set("recVideoFps", f) })),
        },
        "separator",
        { label: "Recording Settings...", action: () => invoke("cmd_open_settings", { tab: "recording" }) },
      ],
      { x: b.left, y: b.bottom + 4 },
    );
  };

  return (
    <div
      data-toolbar
      className="absolute hud rounded-[13px] p-1.5 flex items-center gap-0.5 shadow-2xl"
      style={{ ...pos, animation: "pop-in .16s ease-out" }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <div className="flex bg-white/10 rounded-lg p-0.5 mr-1">
        {(["video", "gif"] as const).map((k) => (
          <button
            key={k}
            onClick={() => setKind(k)}
            className={clsx("h-7 px-2.5 rounded-md text-[12px] font-semibold flex items-center gap-1", kind === k ? "bg-white/25 text-white" : "text-white/60 hover:text-white")}
          >
            {k === "video" ? <Video size={14} /> : <ImageIcon size={14} />}
            {k === "video" ? "Video" : "GIF"}
          </button>
        ))}
      </div>
      <SizeInputs sel={sel} setSel={setSel} ratio={ratio} setRatio={setRatio} W={W} H={H} />
      <Sep />
      {!gif && (
        <>
          <Btn
            wide
            icon={opts.recRecordMicrophone ? <Mic size={15} /> : <MicOff size={15} />}
            label="Microphone: click to toggle, arrow to pick a device"
            active={!!opts.recRecordMicrophone}
            onClick={() => set("recRecordMicrophone", !opts.recRecordMicrophone)}
            onMenu={micMenu}
          >
            <span className="max-w-[92px] truncate">{opts.recRecordMicrophone ? micName : "No mic"}</span>
          </Btn>
          <Btn
            wide
            icon={opts.recRecordComputerAudio ? <Volume2 size={15} /> : <VolumeX size={15} />}
            label="Record the sound of your Mac (apps, videos…)"
            active={!!opts.recRecordComputerAudio}
            onClick={() => set("recRecordComputerAudio", !opts.recRecordComputerAudio)}
          >
            {opts.recRecordComputerAudio ? "System audio" : "No sound"}
          </Btn>
        </>
      )}
      <Btn wide icon={<Webcam size={15} />} label="Camera: click to toggle, arrow to pick a device" active={!!opts.recRecordCamera} onClick={() => set("recRecordCamera", !opts.recRecordCamera)} onMenu={camMenu}>
        {opts.recRecordCamera ? "Camera" : "No camera"}
      </Btn>
      <Btn icon={<MousePointer2 size={15} />} label="Highlight clicks" active={!!opts.recHighlightClicks} onClick={() => set("recHighlightClicks", !opts.recHighlightClicks)} />
      <Btn icon={<Settings2 size={16} />} label="Options" onClick={optionsMenu} />
      <Sep />
      <Btn icon={<X size={16} />} label="Cancel (Esc)" onClick={cancel} />
      <Btn danger wide label="Start recording (↩)" icon={<span className="w-2.5 h-2.5 rounded-full bg-white" />} onClick={() => commit("record", { recordKind: kind, recordOptions: opts, windowId: pickedWindow ?? undefined })}>
        Record
      </Btn>
    </div>
  );
}

export function ScrollToolbar({ p, sel, W, H, commit, cancel }: { p: OverlayPayload; sel: Rect; W: number; H: number; commit: AioProps["commit"]; cancel: () => void }) {
  const [auto, setAuto] = useState<boolean>(!!p.settings.autoscroll);
  const pos = placement(sel, W, H, 330);
  return (
    <div data-toolbar className="absolute hud rounded-[13px] p-1.5 flex items-center gap-1 shadow-2xl" style={{ ...pos, animation: "pop-in .16s ease-out" }} onPointerDown={(e) => e.stopPropagation()}>
      <Btn icon={<ArrowDownToLine size={15} />} label="Scroll automatically" wide active={auto} onClick={() => setAuto(!auto)}>
        Auto-scroll
      </Btn>
      <Sep />
      <Btn icon={<X size={16} />} label="Cancel (Esc)" onClick={cancel} />
      <button
        onClick={() => commit("scroll", { autoscroll: auto })}
        className="h-8 px-3.5 rounded-lg bg-[var(--accent)] hover:brightness-110 text-white text-[12.5px] font-semibold flex items-center gap-1.5"
      >
        <Play size={13} fill="currentColor" /> Start Capture
      </button>
    </div>
  );
}
