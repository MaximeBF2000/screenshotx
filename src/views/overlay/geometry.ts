export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Handle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

export function normRect(x1: number, y1: number, x2: number, y2: number): Rect {
  return { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
}

export function clampRect(r: Rect, W: number, H: number): Rect {
  const w = Math.min(Math.max(1, r.w), W);
  const h = Math.min(Math.max(1, r.h), H);
  const x = Math.min(Math.max(0, r.x), W - w);
  const y = Math.min(Math.max(0, r.y), H - h);
  return { x, y, w, h };
}

export function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, w: Math.round(r.x + r.w) - x, h: Math.round(r.y + r.h) - y };
}

/** Resize `r` by dragging `handle` to (px, py), optionally keeping ratio. */
export function resizeRect(r: Rect, handle: Handle, px: number, py: number, ratio: number | null): Rect {
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;
  if (handle.includes("w")) x1 = px;
  if (handle.includes("e")) x2 = px;
  if (handle.includes("n")) y1 = py;
  if (handle.includes("s")) y2 = py;
  let n = normRect(x1, y1, x2, y2);
  if (ratio) {
    if (handle === "n" || handle === "s") {
      const w = n.h * ratio;
      n = { x: r.x + r.w / 2 - w / 2, y: n.y, w, h: n.h };
    } else if (handle === "e" || handle === "w") {
      const h = n.w / ratio;
      n = { x: n.x, y: r.y + r.h / 2 - h / 2, w: n.w, h };
    } else {
      const h = n.w / ratio;
      const anchorY = handle.includes("n") ? r.y + r.h : r.y;
      n = { x: n.x, y: handle.includes("n") ? anchorY - h : anchorY, w: n.w, h };
    }
  }
  return n;
}

export const RATIOS: { label: string; value: number | null }[] = [
  { label: "Freeform", value: null },
  { label: "1:1 (Square)", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "16:10", value: 16 / 10 },
  { label: "21:9", value: 21 / 9 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:3", value: 2 / 3 },
  { label: "9:16", value: 9 / 16 },
];

export const SIZE_PRESETS: { label: string; w: number; h: number }[] = [
  { label: "640 × 480", w: 640, h: 480 },
  { label: "800 × 600", w: 800, h: 600 },
  { label: "1024 × 768", w: 1024, h: 768 },
  { label: "1280 × 720 (HD)", w: 1280, h: 720 },
  { label: "1280 × 800", w: 1280, h: 800 },
  { label: "1440 × 900", w: 1440, h: 900 },
  { label: "1920 × 1080 (Full HD)", w: 1920, h: 1080 },
  { label: "1080 × 1080 (Instagram)", w: 1080, h: 1080 },
  { label: "1200 × 675 (X / Twitter)", w: 1200, h: 675 },
  { label: "1200 × 630 (Open Graph)", w: 1200, h: 630 },
];
