import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { ImagePlus, Monitor, Plus, Save, Trash2, X } from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { invoke } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { Checkbox, Popover, Slider, Switch, usePopover } from "../../components/ui";
import { ColorPicker, swatchStyle } from "../../components/ColorPicker";
import { useAnnotate } from "./store";
import { gradientById } from "./render";
import { loadBitmap } from "./images";
import { ASPECT_RATIOS, COLORS, GRADIENTS, uid, type Align, type Background, type BgPreset } from "./types";

function gradCss(id: string) {
  const g = gradientById(id);
  return `linear-gradient(${g.angle}deg, ${g.stops.map(([c, o]) => `${c} ${o * 100}%`).join(", ")})`;
}

export async function ensureBackgroundImage(bg: Background) {
  const st = useAnnotate.getState();
  if (bg.kind === "wallpaper" || bg.kind === "blurredWallpaper") {
    if (st.images.has(bg.kind)) return;
    const p = await invoke<string | null>("wallpaper_path", { blurred: bg.kind === "blurredWallpaper" });
    if (p) st.addImage(bg.kind, await loadBitmap(p));
  } else if (bg.kind === "image" && bg.value && !st.images.has(bg.value)) {
    try {
      st.addImage(bg.value, await loadBitmap(bg.value));
    } catch {
      /* missing custom image */
    }
  }
}

const ALIGNS: Align[] = ["tl", "t", "tr", "l", "c", "r", "bl", "b", "br"];

export function BackgroundPanel() {
  const st = useAnnotate();
  const bg = st.doc!.background;
  const settings = useSettings((s) => s.settings);
  const setSettings = useSettings((s) => s.set);
  const presets: BgPreset[] = settings?.backgroundPresets ?? [];
  const customs: string[] = settings?.customBackgrounds ?? [];
  const [more, setMore] = useState<boolean>(settings?.annotateLast?.showMoreGradients ?? false);
  const [current, setCurrent] = useState<string>(settings?.annotateLast?.bgPreset ?? "");
  const [naming, setNaming] = useState<string | null>(null);
  const [live, setLive] = useState<Partial<Background>>({});
  const liveStarted = useRef(false);

  useEffect(() => {
    ensureBackgroundImage(bg);
  }, [bg.kind, bg.value]);

  const set = (patch: Partial<Background>) => st.setBackground({ enabled: true, ...patch });
  // sliders update live without flooding the undo history
  const liveSet = (patch: Partial<Background>) => {
    // one undo step per drag: snapshot the state before the first change
    if (!liveStarted.current) {
      liveStarted.current = true;
      st.pushHistory();
    }
    setLive((l) => ({ ...l, ...patch }));
    const d = useAnnotate.getState().doc!;
    st.setDocLive({ ...d, background: { ...d.background, enabled: true, ...patch } });
  };
  const commitLive = () => {
    liveStarted.current = false;
    setLive({});
  };

  const applyPreset = (p: BgPreset) => {
    const { id, name, ...rest } = p;
    void id;
    void name;
    set({ ...rest, enabled: true });
    setCurrent(p.id);
    setSettings({ annotateLast: { ...(settings?.annotateLast ?? {}), bgPreset: p.id } });
  };
  const savePreset = (name: string) => {
    const { enabled, ...rest } = bg;
    void enabled;
    const p: BgPreset = { ...rest, id: uid(), name };
    setSettings({ backgroundPresets: [...presets, p] });
    setCurrent(p.id);
  };
  const updatePreset = () => {
    const { enabled, ...rest } = bg;
    void enabled;
    setSettings({ backgroundPresets: presets.map((p) => (p.id === current ? { ...p, ...rest } : p)) });
  };
  const deletePreset = () => {
    setSettings({ backgroundPresets: presets.filter((p) => p.id !== current) });
    setCurrent("");
  };
  const addCustom = async () => {
    const p = await openDialog({ multiple: false, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "webp"] }] });
    if (typeof p === "string") {
      setSettings({ customBackgrounds: [...customs.filter((c) => c !== p), p] });
      set({ kind: "image", value: p });
    }
  };

  const tile = (active: boolean) =>
    clsx("aspect-[4/3] rounded-[7px] border transition-transform hover:scale-[1.04]", active ? "ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-[var(--panel)] border-transparent" : "border-black/10");

  return (
    <div className="w-[284px] shrink-0 border-l border-[var(--border)] bg-[var(--panel)] overflow-y-auto text-[12.5px]">
      <div className="flex items-center justify-between px-4 h-11 border-b border-[var(--border)]">
        <span className="font-semibold">Background</span>
        <div className="flex items-center gap-2">
          <Switch checked={bg.enabled} onChange={(v) => st.setBackground({ enabled: v })} small />
          <button className="text-[var(--text-2)] hover:text-[var(--text)]" onClick={() => useAnnotate.setState({ bgPanel: false })}>
            <X size={14} />
          </button>
        </div>
      </div>

      <section className="px-4 py-3 border-b border-[var(--border)]">
        <div className="flex items-center gap-1.5">
          <select
            value={current}
            onChange={(e) => {
              const p = presets.find((x) => x.id === e.target.value);
              if (p) applyPreset(p);
              else setCurrent("");
            }}
            className="flex-1 h-[24px] rounded-md px-1.5 text-[12px] bg-[var(--control)] border border-[var(--control-border)] outline-none"
          >
            <option value="">No preset</option>
            {presets.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button title="Add New Preset..." className="w-6 h-6 rounded-md hover:bg-[var(--hover)] flex items-center justify-center" onClick={() => setNaming("")}>
            <Plus size={14} />
          </button>
          <button title="Save changes to the preset" disabled={!current} className="w-6 h-6 rounded-md hover:bg-[var(--hover)] flex items-center justify-center disabled:opacity-30" onClick={updatePreset}>
            <Save size={13} />
          </button>
          <button title="Delete preset" disabled={!current} className="w-6 h-6 rounded-md hover:bg-[var(--hover)] flex items-center justify-center disabled:opacity-30" onClick={deletePreset}>
            <Trash2 size={13} />
          </button>
        </div>
        {naming !== null && (
          <input
            autoFocus
            placeholder="Enter preset name"
            value={naming}
            onChange={(e) => setNaming(e.target.value)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Enter" && naming.trim()) {
                savePreset(naming.trim());
                setNaming(null);
              }
              if (e.key === "Escape") setNaming(null);
            }}
            onBlur={() => setNaming(null)}
            className="mt-2 w-full h-[24px] rounded-md px-2 text-[12px] bg-[var(--control)] border border-[var(--accent)] outline-none"
          />
        )}
        {current && (
          <div className="mt-2">
            <Checkbox
              checked={!!settings?.autoApplyBackgroundPreset && settings?.autoBackgroundPresetId === current}
              onChange={(v) => setSettings({ autoApplyBackgroundPreset: v, autoBackgroundPresetId: v ? current : "" })}
              label="Apply automatically to all screenshots"
            />
          </div>
        )}
      </section>

      <section className="px-4 py-3 border-b border-[var(--border)]">
        <div className="grid grid-cols-5 gap-1.5">
          {GRADIENTS.slice(0, more ? 20 : 10).map((g) => (
            <button key={g.id} title="Gradient" className={tile(bg.kind === "gradient" && bg.value === g.id)} style={{ background: gradCss(g.id) }} onClick={() => set({ kind: "gradient", value: g.id })} />
          ))}
        </div>
        <button
          className="mt-1.5 text-[11.5px] text-[var(--accent)] hover:underline"
          onClick={() => {
            setMore(!more);
            setSettings({ annotateLast: { ...(settings?.annotateLast ?? {}), showMoreGradients: !more } });
          }}
        >
          {more ? "Show less" : "Show more gradients"}
        </button>
        <div className="grid grid-cols-5 gap-1.5 mt-2">
          <button title="Desktop wallpaper" className={clsx(tile(bg.kind === "wallpaper"), "flex items-center justify-center bg-[var(--hover)]")} onClick={() => set({ kind: "wallpaper", value: "" })}>
            <Monitor size={14} />
          </button>
          <button title="Blurred wallpaper" className={clsx(tile(bg.kind === "blurredWallpaper"), "flex items-center justify-center bg-[var(--hover)] text-[10px] font-medium")} onClick={() => set({ kind: "blurredWallpaper", value: "" })}>
            Blur
          </button>
          <label title="Plain color" className={clsx(tile(bg.kind === "color"), "relative overflow-hidden")} style={{ background: bg.kind === "color" ? bg.value : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)" }}>
            <input type="color" className="absolute inset-0 opacity-0" value={bg.kind === "color" && /^#[0-9a-f]{6}$/i.test(bg.value) ? bg.value : "#ffffff"} onChange={(e) => set({ kind: "color", value: e.target.value })} />
          </label>
          {customs.map((c) => (
            <button
              key={c}
              title={`${c}\nRight-click to remove`}
              className={clsx(tile(bg.kind === "image" && bg.value === c), "bg-cover bg-center")}
              style={{ backgroundImage: `url("sx://localhost/file?p=${encodeURIComponent(c)}")` }}
              onClick={() => set({ kind: "image", value: c })}
              onContextMenu={(e) => {
                e.preventDefault();
                setSettings({ customBackgrounds: customs.filter((x) => x !== c) });
              }}
            />
          ))}
          <button title="Add custom background" className={clsx(tile(false), "flex items-center justify-center border-dashed")} onClick={addCustom}>
            <ImagePlus size={14} className="text-[var(--text-2)]" />
          </button>
        </div>
      </section>

      <section className="px-4 py-3 space-y-2.5 border-b border-[var(--border)]">
        {(
          [
            ["Padding", "padding", 0, 240],
            ["Inset", "inset", 0, 120],
            ["Shadow", "shadow", 0, 100],
            ["Corners", "radius", 0, 48],
          ] as const
        ).map(([label, key, min, max]) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-14 text-[var(--text-2)]">{label}</span>
            <Slider value={(live as any)[key] ?? (bg as any)[key]} min={min} max={max} width={128} onChange={(v) => liveSet({ [key]: v } as any)} onCommit={commitLive} />
            <span className="w-7 text-right tabular-nums text-[11.5px] text-[var(--text-2)]">{Math.round((live as any)[key] ?? (bg as any)[key])}</span>
            {key === "inset" ? <InsetColor /> : <span className="w-[18px] shrink-0" />}
          </div>
        ))}
        <Checkbox checked={bg.autoBalance} onChange={(v) => set({ autoBalance: v })} label="Auto balance" hint="Adjusts the space around the content so it looks evenly centered." />
      </section>

      <section className="px-4 py-3 flex gap-5">
        <div>
          <div className="text-[var(--text-2)] mb-1.5">Alignment</div>
          <div className="grid grid-cols-3 gap-1 w-[66px]">
            {ALIGNS.map((a) => (
              <button
                key={a}
                onClick={() => set({ align: a })}
                className={clsx("w-5 h-5 rounded-[4px] border", bg.align === a ? "bg-[var(--accent)] border-[var(--accent)]" : "border-[var(--border-strong)] hover:bg-[var(--hover)]")}
              />
            ))}
          </div>
        </div>
        <div className="flex-1">
          <div className="text-[var(--text-2)] mb-1.5">Aspect ratio</div>
          <select
            value={ASPECT_RATIOS.findIndex((r) => r.value === bg.ratio)}
            onChange={(e) => set({ ratio: ASPECT_RATIOS[Number(e.target.value)].value })}
            className="w-full h-[24px] rounded-md px-1.5 text-[12px] bg-[var(--control)] border border-[var(--control-border)] outline-none"
          >
            {ASPECT_RATIOS.map((r, i) => (
              <option key={r.label} value={i}>
                {r.label}
              </option>
            ))}
          </select>
        </div>
      </section>
    </div>
  );
}

/** Swatch next to the Inset slider: Auto (the screenshot's edge color) or a custom color. */
function InsetColor() {
  const st = useAnnotate();
  const bg = st.doc!.background;
  const pop = usePopover();
  const settings = useSettings((s) => s.settings);
  const favorites: string[] = settings?.favoriteColors ?? [];
  const auto = !bg.insetColor;
  const started = useRef(false);
  const apply = (insetColor: string) => {
    if (!started.current) {
      started.current = true;
      st.pushHistory();
    }
    const d = useAnnotate.getState().doc!;
    st.setDocLive({ ...d, background: { ...d.background, insetColor } });
  };
  const close = () => {
    started.current = false;
    pop.close();
  };
  return (
    <>
      <button
        title={auto ? "Inset color: Auto (matches the screenshot's edges)" : "Inset color"}
        onClick={pop.open ? close : pop.toggle}
        className="w-[18px] h-[18px] shrink-0 rounded-full border border-black/15 flex items-center justify-center text-[8px] font-semibold text-[var(--text-2)]"
        style={auto ? { background: "conic-gradient(#ff3b30, #ffcc00, #34c759, #007aff, #af52de, #ff3b30)" } : { ...swatchStyle(bg.insetColor!), boxShadow: "inset 0 0 0 1.5px rgba(255,255,255,0.35)" }}
      />
      <Popover anchor={pop.anchor} open={pop.open} onClose={close}>
        <div className="px-3 pt-2.5 pb-1 flex items-center justify-between">
          <span className="text-[12px] font-medium">Inset color</span>
          <button
            onClick={() => apply("")}
            className={clsx("h-[22px] px-2 rounded-md text-[11.5px] border", auto ? "bg-[var(--accent)] border-[var(--accent)] text-white" : "border-[var(--control-border)] hover:bg-[var(--hover)]")}
          >
            Auto
          </button>
        </div>
        <ColorPicker
          key={auto ? "auto" : "custom"}
          value={bg.insetColor || "#FFFFFF"}
          onChange={apply}
          presets={COLORS.filter((c) => c.value !== "transparent")}
          favorites={favorites}
          onFavorites={(f) => useSettings.getState().set({ favoriteColors: f })}
        />
      </Popover>
    </>
  );
}
