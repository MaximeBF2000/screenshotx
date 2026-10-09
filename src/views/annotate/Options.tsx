import { useEffect, useRef } from "react";
import clsx from "clsx";
import {
  ChevronDown,
  AlignCenter,
  AlignLeft,
  AlignRight,
  BringToFront,
  Circle,
  Copy,
  RotateCcw,
  SendToBack,
  Smile,
  Square,
  Trash2,
} from "lucide-react";
import { invoke } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { IconButton, Popover, Segmented, Slider, usePopover } from "../../components/ui";
import { ColorPicker, swatchStyle } from "../../components/ColorPicker";
import { drawObject, measureText } from "./render";
import { useAnnotate } from "./store";
import { COLORS, COUNTER_STYLES, TEXT_STYLES, type ArrowStyle, type PixelateStyle, type TextObj, type Tool } from "./types";

const SIZE_TOOLS: Tool[] = ["rect", "ellipse", "line", "arrow", "pen", "highlighter", "counter", "text"];
const COLOR_TOOLS: Tool[] = ["rect", "ellipse", "line", "arrow", "text", "counter", "pen", "move"];

export function ColorButton({ highlight }: { highlight?: boolean }) {
  const { ts, setTs, selected, doc } = useAnnotate();
  const pop = usePopover();
  const settings = useSettings((s) => s.settings);
  const favorites: string[] = settings?.favoriteColors ?? [];
  const showNames = settings?.annotateShowColorNames ?? false;
  const setFav = (f: string[]) => useSettings.getState().set({ favoriteColors: f });
  // show the selected object's color when exactly one is selected
  const sel = selected.length === 1 ? doc?.objects.find((o) => o.id === selected[0]) : undefined;
  const value = sel?.color ?? (highlight ? ts.highlightColor : ts.color);
  const key = highlight ? "highlightColor" : "color";
  const name = COLORS.find((c) => c.value.toLowerCase() === value.slice(0, 7).toLowerCase())?.name ?? "Custom";
  return (
    <>
      <button title="Color & opacity" onClick={pop.toggle} className="h-[26px] pl-1 pr-1.5 rounded-[7px] flex items-center gap-1.5 hover:bg-[var(--hover)]">
        <span className="w-[18px] h-[18px] rounded-full border border-black/15" style={{ ...swatchStyle(value), boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.35)" }} />
        {showNames && <span className="text-[12px]">{name}</span>}
        {value.length === 9 && <span className="text-[11px] tabular-nums text-[var(--text-2)]">{Math.round((parseInt(value.slice(7, 9), 16) / 255) * 100)}%</span>}
      </button>
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close}>
        <ColorPicker
          value={value}
          onChange={(c) => setTs({ [key]: c } as any)}
          presets={COLORS.filter((c) => c.value !== "transparent")}
          favorites={favorites}
          onFavorites={setFav}
          showNames={showNames}
        />
      </Popover>
    </>
  );
}

/** Text style dropdown that previews each style as it will render. */
function TextStylePicker() {
  const { ts, setTs } = useAnnotate();
  const pop = usePopover();
  return (
    <>
      <button onClick={pop.toggle} title="Text style" className="h-[26px] pl-1 pr-1.5 rounded-[7px] flex items-center gap-1 hover:bg-[var(--hover)] border border-[var(--control-border)] bg-[var(--control)]">
        <TextStylePreview style={ts.textStyle} color={ts.color} width={84} height={20} />
        <ChevronDown size={12} className="text-[var(--text-2)]" />
      </button>
      <Popover anchor={pop.anchor} open={pop.open} onClose={pop.close} className="w-[272px]">
        {TEXT_STYLES.map((name, i) => (
          <button
            key={name}
            onClick={() => {
              setTs({ textStyle: i });
              pop.close();
            }}
            className={clsx("w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-[var(--hover)]", ts.textStyle === i && "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]")}
          >
            <TextStylePreview style={i} color={ts.color} width={120} height={30} />
            <span className="text-[11.5px] text-[var(--text-2)] whitespace-nowrap">{name}</span>
          </button>
        ))}
      </Popover>
    </>
  );
}

function TextStylePreview({ style, color, width, height }: { style: number; color: string; width: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const dpr = window.devicePixelRatio || 2;
    c.width = width * dpr;
    c.height = height * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const fontSize = height * 0.5;
    const o: TextObj = { id: "preview", type: "text", x: 0, y: 0, text: "Text", style, fontSize, align: "left", width: 0, color, size: 4, shadow: false };
    const L = measureText(o);
    o.x = Math.max(1, (width - L.width) / 2);
    o.y = (height - L.height) / 2;
    drawObject(ctx, o, { images: new Map(), drawShadows: false });
  }, [style, color, width, height]);
  return <canvas ref={ref} style={{ width, height }} className="block" />;
}

function SizeControl() {
  const { ts, setTs, tool } = useAnnotate();
  const presets = [2, 4, 8];
  return (
    <div className="flex items-center gap-1">
      {presets.map((s) => (
        <IconButton key={s} title={`${s === 2 ? "Thin" : s === 4 ? "Medium" : "Thick"} ([ / ] to adjust)`} active={ts.size === s} onClick={() => setTs({ size: s })}>
          <span className="block rounded-full bg-current" style={{ width: tool === "counter" ? 6 + s * 1.4 : 14, height: tool === "counter" ? 6 + s * 1.4 : Math.max(1.5, s * 0.75) }} />
        </IconButton>
      ))}
      <Slider value={ts.size} min={1} max={20} onChange={(v) => setTs({ size: v })} width={84} />
    </div>
  );
}

const ARROWS: { id: ArrowStyle; label: string; path: string }[] = [
  { id: "standard", label: "Standard", path: "M3 17 L16 4 M9 4 H16 V11" },
  { id: "fancy", label: "Fancy", path: "M3 18 L13 8 L11 6 L18 3 L15 10 L13 8" },
  { id: "double", label: "Double", path: "M4 16 L16 4 M10 4 H16 V10 M4 10 V16 H10" },
  { id: "curved", label: "Curved", path: "M3 17 Q3 5 15 5 M11 2 L15 5 L11 8" },
];

const PIXELATE: { id: PixelateStyle; label: string }[] = [
  { id: "pixelate", label: "Pixelate" },
  { id: "blur", label: "Blur (secure)" },
  { id: "smooth", label: "Blur (smooth)" },
];

const Sep = () => <div className="w-px h-5 bg-[var(--border)] mx-1.5" />;

export function OptionsBar() {
  const st = useAnnotate();
  const { tool, ts, setTs, selected, doc } = st;
  const selObjs = doc?.objects.filter((o) => selected.includes(o.id)) ?? [];
  const selType = selObjs.length === 1 ? selObjs[0].type : null;
  const effective: Tool = selType ? (selType === "highlightRect" ? "highlighter" : selType === "filledRect" ? "rect" : (selType as Tool)) : tool;
  const counterPop = usePopover();

  if (tool === "crop") return <CropOptions />;

  return (
    <div className="h-[40px] shrink-0 flex items-center px-3 gap-0.5 border-b border-[var(--border)] bg-[var(--win-bg)] text-[var(--text)] overflow-x-auto">
      {COLOR_TOOLS.includes(effective) && <ColorButton />}
      {effective === "highlighter" && <ColorButton highlight />}
      {(effective === "rect" || effective === "ellipse") && (
        <>
          <Sep />
          <Segmented
            size="sm"
            value={ts.fill ? "fill" : "outline"}
            onChange={(v) => setTs({ fill: v === "fill" })}
            options={[
              { value: "outline", label: effective === "rect" ? <Square size={13} /> : <Circle size={13} />, title: "Outline" },
              { value: "fill", label: effective === "rect" ? <Square size={13} fill="currentColor" /> : <Circle size={13} fill="currentColor" />, title: "Filled (F)" },
            ]}
          />
        </>
      )}
      {SIZE_TOOLS.includes(effective) && effective !== "text" && (
        <>
          <Sep />
          <SizeControl />
        </>
      )}
      {effective === "arrow" && (
        <>
          <Sep />
          {ARROWS.map((a) => (
            <IconButton key={a.id} title={`${a.label} arrow`} active={ts.arrowStyle === a.id} onClick={() => setTs({ arrowStyle: a.id })}>
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d={a.path} fill={a.id === "fancy" ? "currentColor" : "none"} />
              </svg>
            </IconButton>
          ))}
        </>
      )}
      {effective === "rect" && (
        <>
          <Sep />
          <span className="text-[11.5px] text-[var(--text-2)] mr-1">Corners</span>
          <Slider value={ts.rectRadius} min={0} max={30} onChange={(v) => setTs({ rectRadius: v })} width={80} />
        </>
      )}
      {effective === "text" && (
        <>
          <Sep />
          <TextStylePicker />
          <Sep />
          <span className="text-[11.5px] text-[var(--text-2)] mr-1">Size</span>
          <Slider value={ts.fontSize} min={10} max={96} onChange={(v) => setTs({ fontSize: v })} width={90} />
          <span className="text-[11.5px] tabular-nums w-6 text-[var(--text-2)]">{ts.fontSize}</span>
          <Sep />
          <IconButton title="Align left" active={ts.textAlign === "left"} onClick={() => setTs({ textAlign: "left" })}>
            <AlignLeft size={15} />
          </IconButton>
          <IconButton title="Align center" active={ts.textAlign === "center"} onClick={() => setTs({ textAlign: "center" })}>
            <AlignCenter size={15} />
          </IconButton>
          <IconButton title="Align right" active={ts.textAlign === "right"} onClick={() => setTs({ textAlign: "right" })}>
            <AlignRight size={15} />
          </IconButton>
          <Sep />
          {/* mousedown is prevented so the text being edited keeps focus */}
          <span onMouseDown={(e) => e.preventDefault()}>
            <IconButton title="Emoji & Symbols (⌃⌘Space)" onClick={() => invoke("emoji_palette")}>
              <Smile size={15} />
            </IconButton>
          </span>
        </>
      )}
      {effective === "pixelate" && (
        <>
          <Sep />
          {PIXELATE.map((p) => (
            <IconButton key={p.id} title={p.label} active={ts.pixelate === p.id} onClick={() => setTs({ pixelate: p.id })} className="px-2">
              <span className="text-[12px]">{p.label}</span>
            </IconButton>
          ))}
          <Sep />
          <span className="text-[11.5px] text-[var(--text-2)] mr-1">Intensity</span>
          <Slider value={ts.intensity} min={3} max={30} onChange={(v) => setTs({ intensity: v })} width={90} />
        </>
      )}
      {effective === "spotlight" && (
        <>
          <IconButton title="Rectangle" active={ts.spotlightShape === "rect"} onClick={() => setTs({ spotlightShape: "rect" })}>
            <Square size={15} />
          </IconButton>
          <IconButton title="Ellipse" active={ts.spotlightShape === "ellipse"} onClick={() => setTs({ spotlightShape: "ellipse" })}>
            <Circle size={15} />
          </IconButton>
        </>
      )}
      {effective === "highlighter" && (
        <>
          <Sep />
          <IconButton title="Freehand" active={ts.highlightShape === "free"} onClick={() => setTs({ highlightShape: "free" })} className="px-2">
            <span className="text-[12px]">Freehand</span>
          </IconButton>
          <IconButton title="Rectangle" active={ts.highlightShape === "rect"} onClick={() => setTs({ highlightShape: "rect" })} className="px-2">
            <span className="text-[12px]">Rectangle</span>
          </IconButton>
        </>
      )}
      {effective === "counter" && (
        <>
          <Sep />
          <IconButton title="Counter settings" onClick={counterPop.toggle} className="px-2">
            <span className="text-[12px]">{COUNTER_STYLES.find((c) => c.id === ts.counterStyle)?.label}</span>
          </IconButton>
          <Popover anchor={counterPop.anchor} open={counterPop.open} onClose={counterPop.close} className="w-[190px]">
            {COUNTER_STYLES.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setTs({ counterStyle: c.id });
                  counterPop.close();
                }}
                className={clsx("w-full text-left px-2 py-1.5 rounded-md text-[12.5px] hover:bg-[var(--hover)]", ts.counterStyle === c.id && "text-[var(--accent)] font-medium")}
              >
                {c.label}
              </button>
            ))}
            <div className="border-t border-[var(--border)] mt-1 pt-1">
              <button
                className="w-full text-left px-2 py-1.5 rounded-md text-[12.5px] hover:bg-[var(--hover)] flex items-center gap-1.5"
                onClick={() => {
                  // renumber all counters in creation order
                  const d = useAnnotate.getState().doc!;
                  let n = 1;
                  st.commit({ ...d, objects: d.objects.map((o) => (o.type === "counter" ? { ...o, value: n++ } : o)) });
                  counterPop.close();
                }}
              >
                <RotateCcw size={13} /> Renumber counters
              </button>
            </div>
          </Popover>
        </>
      )}
      {!["pixelate", "spotlight", "highlighter", "crop"].includes(effective) && (
        <>
          <Sep />
          <IconButton title="Shadow" active={ts.shadow} onClick={() => setTs({ shadow: !ts.shadow })} className="px-2">
            <span className="text-[12px]">Shadow</span>
          </IconButton>
        </>
      )}
      <div className="flex-1" />
      {selected.length > 0 && (
        <>
          <IconButton title="Bring to front (⌥⌘↑)" onClick={() => st.arrange("front")}>
            <BringToFront size={15} />
          </IconButton>
          <IconButton title="Send to back (⌥⌘↓)" onClick={() => st.arrange("back")}>
            <SendToBack size={15} />
          </IconButton>
          <IconButton title="Duplicate (⌘D)" onClick={() => st.duplicateSelected()}>
            <Copy size={15} />
          </IconButton>
          <IconButton title="Delete (⌫)" onClick={() => st.removeSelected()}>
            <Trash2 size={15} />
          </IconButton>
        </>
      )}
    </div>
  );
}

function CropOptions() {
  const st = useAnnotate();
  const crop = st.crop;
  const doc = st.doc!;
  const ratios: { label: string; value: number | null }[] = [
    { label: "Freeform", value: null },
    { label: "Original", value: doc.baseW / doc.baseH },
    { label: "1:1", value: 1 },
    { label: "4:3", value: 4 / 3 },
    { label: "3:2", value: 3 / 2 },
    { label: "16:9", value: 16 / 9 },
    { label: "16:10", value: 1.6 },
    { label: "9:16", value: 9 / 16 },
  ];
  const setRatio = (r: number | null) => {
    useAnnotate.setState({ cropRatio: r });
    if (r && crop) useAnnotate.setState({ crop: { ...crop, h: Math.round(crop.w / r) } });
  };
  return (
    <div className="h-[40px] shrink-0 flex items-center px-3 gap-2 border-b border-[var(--border)] bg-[var(--win-bg)] text-[var(--text)]">
      <span className="text-[12px] text-[var(--text-2)]">Aspect ratio</span>
      <select
        value={ratios.findIndex((r) => r.value === st.cropRatio)}
        onChange={(e) => setRatio(ratios[Number(e.target.value)]?.value ?? null)}
        className="h-[24px] rounded-md px-1.5 text-[12px] bg-[var(--control)] border border-[var(--control-border)] outline-none"
      >
        {ratios.map((r, i) => (
          <option key={r.label} value={i}>
            {r.label}
          </option>
        ))}
      </select>
      {crop && (
        <>
          <span className="text-[12px] text-[var(--text-2)] ml-2">Size</span>
          <input
            className="w-[60px] h-[22px] rounded-[5px] px-1.5 text-[12px] text-right tabular-nums bg-[var(--control)] border border-[var(--control-border)]"
            value={Math.round(crop.w)}
            onChange={(e) => {
              const w = Number(e.target.value) || 1;
              useAnnotate.setState({ crop: { ...crop, w, h: st.cropRatio ? Math.round(w / st.cropRatio) : crop.h } });
            }}
          />
          <span className="text-[11px]">×</span>
          <input
            className="w-[60px] h-[22px] rounded-[5px] px-1.5 text-[12px] text-right tabular-nums bg-[var(--control)] border border-[var(--control-border)]"
            value={Math.round(crop.h)}
            onChange={(e) => {
              const h = Number(e.target.value) || 1;
              useAnnotate.setState({ crop: { ...crop, h, w: st.cropRatio ? Math.round(h * st.cropRatio) : crop.w } });
            }}
          />
        </>
      )}
      <div className="flex-1" />
      <span className="text-[11.5px] text-[var(--text-3)]">Drag outside the image to expand the canvas</span>
      <button
        className="h-[24px] px-2.5 rounded-md text-[12px] hover:bg-[var(--hover)]"
        onClick={() => {
          useAnnotate.setState({ crop: { x: 0, y: 0, w: doc.baseW, h: doc.baseH } });
        }}
      >
        Reset
      </button>
      <button className="h-[24px] px-2.5 rounded-md text-[12px] hover:bg-[var(--hover)]" onClick={() => st.setTool("arrow")}>
        Cancel
      </button>
      <button
        className="h-[24px] px-3 rounded-md text-[12px] font-semibold bg-[var(--accent)] text-white hover:brightness-110"
        onClick={() => {
          const c = useAnnotate.getState().crop;
          if (c && c.w > 2 && c.h > 2) st.setCanvas(c);
          st.setTool("arrow");
        }}
      >
        Apply ↩
      </button>
    </div>
  );
}
