import { useEffect, useRef, useState } from "react";
import clsx from "clsx";
import { Pipette, Plus } from "lucide-react";
import { invoke } from "../lib/ipc";

export interface Swatch {
  name: string;
  value: string;
}

// ---------------------------------------------------------------- color math

export function parseHex(hex: string): { r: number; g: number; b: number; a: number } {
  let m = hex.trim().replace("#", "");
  if (m.length === 3) m = m.split("").map((c) => c + c).join("");
  const n = (i: number) => parseInt(m.slice(i, i + 2), 16) || 0;
  return { r: n(0), g: n(2), b: n(4), a: m.length === 8 ? n(6) / 255 : 1 };
}

export function toHex(r: number, g: number, b: number, a = 1): string {
  const h = (v: number) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0").toUpperCase();
  return `#${h(r)}${h(g)}${h(b)}${a < 0.999 ? h(a * 255) : ""}`;
}

function rgbToHsv(r: number, g: number, b: number) {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

function hsvToRgb(h: number, s: number, v: number) {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return { r: (r + m) * 255, g: (g + m) * 255, b: (b + m) * 255 };
}

/** CSS for a color swatch (checkerboard shows through transparency). */
export function swatchStyle(c: string): React.CSSProperties {
  return {
    backgroundImage: `linear-gradient(${c}, ${c}), conic-gradient(#ccc 25%, #fff 0 50%, #ccc 0 75%, #fff 0)`,
    backgroundSize: "100% 100%, 8px 8px",
  };
}

// ---------------------------------------------------------------- component

/** Saturation/brightness square + hue + opacity, hex input, eyedropper,
 * presets and favorites. Emits #RRGGBB or #RRGGBBAA. */
export function ColorPicker({
  value,
  onChange,
  presets,
  favorites,
  onFavorites,
  showNames,
}: {
  value: string;
  onChange: (hex: string) => void;
  presets: Swatch[];
  favorites: string[];
  onFavorites: (f: string[]) => void;
  showNames?: boolean;
}) {
  const rgba = parseHex(value === "transparent" ? "#00000000" : value);
  const [hsv, setHsv] = useState(() => rgbToHsv(rgba.r, rgba.g, rgba.b));
  const [alpha, setAlpha] = useState(rgba.a);
  const [hexText, setHexText] = useState(value);
  const sv = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef(value);

  // follow external changes (presets, eyedropper, selection change)
  useEffect(() => {
    if (value === lastEmitted.current) return;
    const c = parseHex(value === "transparent" ? "#00000000" : value);
    setHsv(rgbToHsv(c.r, c.g, c.b));
    setAlpha(c.a);
    setHexText(value);
    lastEmitted.current = value;
  }, [value]);

  const emit = (h: { h: number; s: number; v: number }, a: number) => {
    const { r, g, b } = hsvToRgb(h.h, h.s, h.v);
    const hex = toHex(r, g, b, a);
    lastEmitted.current = hex;
    setHexText(hex);
    onChange(hex);
  };

  const dragSV = (e: React.PointerEvent) => {
    const el = sv.current!;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent | React.PointerEvent) => {
      const r = el.getBoundingClientRect();
      const s = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      const v = Math.max(0, Math.min(1, 1 - (ev.clientY - r.top) / r.height));
      const next = { ...hsv, s, v };
      setHsv(next);
      emit(next, alpha);
    };
    move(e);
    const onMove = (ev: PointerEvent) => move(ev);
    const onUp = () => {
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
  };

  const pure = hsvToRgb(hsv.h, 1, 1);
  const pureCss = `rgb(${pure.r},${pure.g},${pure.b})`;
  const cur = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const opaqueCss = `rgb(${cur.r},${cur.g},${cur.b})`;

  return (
    <div className="w-[236px] select-none">
      <div
        ref={sv}
        onPointerDown={dragSV}
        className="relative h-[130px] rounded-lg overflow-hidden cursor-crosshair"
        style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, ${pureCss})` }}
      >
        <div
          className="absolute w-3.5 h-3.5 -ml-[7px] -mt-[7px] rounded-full border-2 border-white pointer-events-none"
          style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, boxShadow: "0 0 0 1px rgba(0,0,0,.4)", background: opaqueCss }}
        />
      </div>
      <div className="flex items-center gap-2 mt-2.5">
        <button
          title="Pick a color from the screen"
          onClick={async () => {
            const c = await invoke<string | null>("pick_color");
            if (c) {
              const p = parseHex(c);
              const next = rgbToHsv(p.r, p.g, p.b);
              setHsv(next);
              emit(next, alpha);
            }
          }}
          className="w-7 h-7 rounded-md flex items-center justify-center hover:bg-[var(--hover)] shrink-0"
        >
          <Pipette size={15} />
        </button>
        <div className="flex-1 space-y-2">
          <input
            type="range"
            min={0}
            max={360}
            value={hsv.h}
            onChange={(e) => {
              const next = { ...hsv, h: Number(e.target.value) };
              setHsv(next);
              emit(next, alpha);
            }}
            className="sx-hue w-full"
          />
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(alpha * 100)}
            onChange={(e) => {
              const a = Number(e.target.value) / 100;
              setAlpha(a);
              emit(hsv, a);
            }}
            className="sx-alpha w-full"
            style={{ ["--c" as any]: opaqueCss }}
          />
        </div>
        <span className="w-7 h-7 rounded-md border border-black/10 shrink-0" style={swatchStyle(value === "transparent" ? "transparent" : value)} />
      </div>
      <div className="flex items-center gap-1.5 mt-2">
        <input
          value={hexText}
          onChange={(e) => setHexText(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
          onBlur={() => {
            const t = hexText.trim().startsWith("#") ? hexText.trim() : `#${hexText.trim()}`;
            if (/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(t)) {
              const p = parseHex(t);
              const next = rgbToHsv(p.r, p.g, p.b);
              setHsv(next);
              setAlpha(p.a);
              emit(next, p.a);
            } else setHexText(value);
          }}
          className="flex-1 h-[24px] rounded-md px-2 text-[12px] font-mono bg-[var(--control)] border border-[var(--control-border)] outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--accent)_40%,transparent)]"
        />
        <span className="w-[54px] h-[24px] rounded-md flex items-center justify-end px-2 text-[12px] tabular-nums bg-[var(--control)] border border-[var(--control-border)]">{Math.round(alpha * 100)}%</span>
      </div>
      <div className="grid grid-cols-9 gap-1.5 mt-3">
        {presets.map((c) => (
          <button
            key={c.value}
            title={c.name}
            onClick={() => {
              const p = parseHex(c.value === "transparent" ? "#00000000" : c.value);
              const next = rgbToHsv(p.r, p.g, p.b);
              setHsv(next);
              // keep the current opacity unless the preset defines one
              const a = c.value === "transparent" ? 0 : c.value.length === 9 ? p.a : alpha;
              setAlpha(a);
              emit(next, a);
            }}
            className={clsx(
              "w-[21px] h-[21px] rounded-full border border-black/10 hover:scale-110 transition-transform",
              value.slice(0, 7).toUpperCase() === c.value.slice(0, 7).toUpperCase() && "ring-2 ring-offset-1 ring-[var(--accent)] ring-offset-[var(--panel)]",
            )}
            style={swatchStyle(c.value)}
          />
        ))}
      </div>
      {showNames && <div className="text-[11px] text-[var(--text-2)] mt-1.5">{presets.find((p) => p.value.slice(0, 7).toUpperCase() === value.slice(0, 7).toUpperCase())?.name ?? "Custom"}</div>}
      <div className="mt-3 pt-2 border-t border-[var(--border)]">
        <div className="text-[11px] font-medium text-[var(--text-2)] mb-1.5 flex items-center justify-between">
          Favorites
          <button
            title="Add current color to favorites"
            className="text-[var(--accent)] hover:underline flex items-center gap-0.5"
            onClick={() => !favorites.includes(value) && onFavorites([...favorites, value].slice(-18))}
          >
            <Plus size={11} /> Add
          </button>
        </div>
        <div className="flex flex-wrap gap-1.5 min-h-[22px]">
          {favorites.length === 0 && <span className="text-[11px] text-[var(--text-3)]">No favorite colors yet</span>}
          {favorites.map((c) => (
            <button
              key={c}
              title={`${c} (right-click to remove)`}
              onClick={() => {
                const p = parseHex(c);
                const next = rgbToHsv(p.r, p.g, p.b);
                setHsv(next);
                setAlpha(p.a);
                emit(next, p.a);
              }}
              onContextMenu={(e) => {
                e.preventDefault();
                onFavorites(favorites.filter((f) => f !== c));
              }}
              className="w-[21px] h-[21px] rounded-full border border-black/10 hover:scale-110 transition-transform"
              style={swatchStyle(c)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
