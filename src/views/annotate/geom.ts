import { counterRadius, curveControl, measureText } from "./render";
import type { BoxObj, LineObj, Obj, Pt } from "./types";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function norm(b: Box): Box {
  return { x: Math.min(b.x, b.x + b.w), y: Math.min(b.y, b.y + b.h), w: Math.abs(b.w), h: Math.abs(b.h) };
}

export function union(a: Box, b: Box): Box {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

export function bounds(o: Obj): Box {
  switch (o.type) {
    case "line":
    case "arrow": {
      // the control point lies off the curve: bound the curve itself
      const pts = o.type === "arrow" && o.style === "curved" ? quadPoints(o) : [{ x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }];
      const xs = pts.map((p) => p.x);
      const ys = pts.map((p) => p.y);
      const pad = o.size + (o.type === "arrow" ? 10 : 0);
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    }
    case "pen":
    case "highlighter": {
      const xs = o.points.map((p) => p.x);
      const ys = o.points.map((p) => p.y);
      const pad = o.size / 2;
      return { x: Math.min(...xs) - pad, y: Math.min(...ys) - pad, w: Math.max(...xs) - Math.min(...xs) + pad * 2, h: Math.max(...ys) - Math.min(...ys) + pad * 2 };
    }
    case "text": {
      const L = measureText(o);
      return { x: o.x, y: o.y, w: L.width, h: L.height };
    }
    case "counter": {
      const r = counterRadius(o);
      return { x: o.x - r, y: o.y - r, w: r * 2, h: r * 2 };
    }
    default: {
      const b = norm(o as Box);
      const pad = o.type === "rect" || o.type === "ellipse" ? o.size / 2 : 0;
      return { x: b.x - pad, y: b.y - pad, w: b.w + pad * 2, h: b.h + pad * 2 };
    }
  }
}

function distSeg(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}

function quadPoints(o: LineObj): Pt[] {
  const c = curveControl(o);
  const pts: Pt[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = i / 24;
    pts.push({
      x: (1 - t) * (1 - t) * o.x1 + 2 * (1 - t) * t * c.x + t * t * o.x2,
      y: (1 - t) * (1 - t) * o.y1 + 2 * (1 - t) * t * c.y + t * t * o.y2,
    });
  }
  return pts;
}

/**
 * Does point `p` hit object `o`? `strict` = only the visible stroke of
 * hollow shapes (so a drawing tool can still start inside a rectangle).
 */
export function hit(o: Obj, p: Pt, tol: number, strict: boolean): boolean {
  switch (o.type) {
    case "line":
    case "arrow": {
      const t = o.size / 2 + tol + (o.type === "arrow" ? 4 : 0);
      if (o.type === "arrow" && o.style === "curved") {
        const pts = quadPoints(o);
        for (let i = 1; i < pts.length; i++) if (distSeg(p, pts[i - 1], pts[i]) < t) return true;
        return false;
      }
      return distSeg(p, { x: o.x1, y: o.y1 }, { x: o.x2, y: o.y2 }) < t;
    }
    case "pen":
    case "highlighter": {
      const t = o.size / 2 + tol;
      if (o.points.length === 1) return Math.hypot(p.x - o.points[0].x, p.y - o.points[0].y) < t;
      for (let i = 1; i < o.points.length; i++) if (distSeg(p, o.points[i - 1], o.points[i]) < t) return true;
      return false;
    }
    case "rect":
    case "ellipse": {
      const b = norm(o as Box);
      const t = o.size / 2 + tol;
      const inside = p.x >= b.x - t && p.x <= b.x + b.w + t && p.y >= b.y - t && p.y <= b.y + b.h + t;
      if (!inside) return false;
      if (!strict || (o as BoxObj).fill) {
        if (o.type === "ellipse") {
          const nx = (p.x - b.x - b.w / 2) / Math.max(1, b.w / 2);
          const ny = (p.y - b.y - b.h / 2) / Math.max(1, b.h / 2);
          return nx * nx + ny * ny <= 1.15;
        }
        return true;
      }
      if (o.type === "ellipse") {
        const rx = b.w / 2;
        const ry = b.h / 2;
        const nx = (p.x - b.x - rx) / Math.max(1, rx);
        const ny = (p.y - b.y - ry) / Math.max(1, ry);
        const d = Math.sqrt(nx * nx + ny * ny);
        return Math.abs(d - 1) * Math.min(rx, ry) < t;
      }
      const innerT = p.x > b.x + t && p.x < b.x + b.w - t && p.y > b.y + t && p.y < b.y + b.h - t;
      return !innerT;
    }
    default: {
      const b = bounds(o);
      return p.x >= b.x - tol && p.x <= b.x + b.w + tol && p.y >= b.y - tol && p.y <= b.y + b.h + tol;
    }
  }
}

export function topHit(objs: Obj[], p: Pt, tol: number, strict: boolean): Obj | null {
  for (let i = objs.length - 1; i >= 0; i--) if (hit(objs[i], p, tol, strict)) return objs[i];
  return null;
}

export function translate(o: Obj, dx: number, dy: number): Obj {
  switch (o.type) {
    case "line":
    case "arrow":
      return {
        ...o,
        x1: o.x1 + dx,
        y1: o.y1 + dy,
        x2: o.x2 + dx,
        y2: o.y2 + dy,
        ...(o.cx !== undefined ? { cx: o.cx + dx, cy: (o.cy ?? 0) + dy } : {}),
      };
    case "pen":
    case "highlighter":
      return { ...o, points: o.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
    default:
      return { ...o, x: (o as any).x + dx, y: (o as any).y + dy } as Obj;
  }
}

/** Map every coordinate of an object through `f` (rotate / flip / scale). */
export function mapObj(o: Obj, f: (p: Pt) => Pt, sizeK = 1): Obj {
  switch (o.type) {
    case "line":
    case "arrow": {
      const a = f({ x: o.x1, y: o.y1 });
      const b = f({ x: o.x2, y: o.y2 });
      const c = o.cx !== undefined ? f({ x: o.cx, y: o.cy! }) : undefined;
      return { ...o, x1: a.x, y1: a.y, x2: b.x, y2: b.y, ...(c ? { cx: c.x, cy: c.y } : {}), size: o.size * sizeK };
    }
    case "pen":
    case "highlighter":
      return { ...o, points: o.points.map(f), size: o.size * sizeK };
    case "text": {
      const b = bounds(o);
      const p1 = f({ x: b.x, y: b.y });
      const p2 = f({ x: b.x + b.w, y: b.y + b.h });
      return { ...o, x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), fontSize: o.fontSize * sizeK };
    }
    case "counter": {
      const p = f({ x: o.x, y: o.y });
      return { ...o, x: p.x, y: p.y, size: o.size * sizeK };
    }
    default: {
      const b = o as BoxObj;
      const p1 = f({ x: b.x, y: b.y });
      const p2 = f({ x: b.x + b.w, y: b.y + b.h });
      return { ...b, x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y), size: b.size * sizeK } as Obj;
    }
  }
}

export type HandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "p1" | "p2" | "ctrl";

/** Handles shown for a selected object (doc coordinates). */
export function handles(o: Obj): { id: HandleId; x: number; y: number }[] {
  if (o.type === "line" || o.type === "arrow") {
    const hs: { id: HandleId; x: number; y: number }[] = [
      { id: "p1", x: o.x1, y: o.y1 },
      { id: "p2", x: o.x2, y: o.y2 },
    ];
    if (o.type === "arrow" && o.style === "curved") {
      const c = curveControl(o);
      // the handle sits on the curve (t = 0.5), not on the control point
      hs.push({ id: "ctrl", x: 0.25 * o.x1 + 0.5 * c.x + 0.25 * o.x2, y: 0.25 * o.y1 + 0.5 * c.y + 0.25 * o.y2 });
    }
    return hs;
  }
  if (o.type === "pen" || o.type === "highlighter" || o.type === "counter") return [];
  const b = o.type === "text" ? bounds(o) : norm(o as Box);
  if (o.type === "text")
    // corners scale the text, sides set the wrap width
    return [
      { id: "nw", x: b.x, y: b.y },
      { id: "ne", x: b.x + b.w, y: b.y },
      { id: "se", x: b.x + b.w, y: b.y + b.h },
      { id: "sw", x: b.x, y: b.y + b.h },
      { id: "e", x: b.x + b.w, y: b.y + b.h / 2 },
      { id: "w", x: b.x, y: b.y + b.h / 2 },
    ];
  return [
    { id: "nw", x: b.x, y: b.y },
    { id: "n", x: b.x + b.w / 2, y: b.y },
    { id: "ne", x: b.x + b.w, y: b.y },
    { id: "e", x: b.x + b.w, y: b.y + b.h / 2 },
    { id: "se", x: b.x + b.w, y: b.y + b.h },
    { id: "s", x: b.x + b.w / 2, y: b.y + b.h },
    { id: "sw", x: b.x, y: b.y + b.h },
    { id: "w", x: b.x, y: b.y + b.h / 2 },
  ];
}

export function resizeBox(b: Box, h: HandleId, p: Pt, keepRatio: number | null): Box {
  let x1 = b.x;
  let y1 = b.y;
  let x2 = b.x + b.w;
  let y2 = b.y + b.h;
  if (h.includes("w")) x1 = p.x;
  if (h.includes("e")) x2 = p.x;
  if (h.includes("n")) y1 = p.y;
  if (h.includes("s")) y2 = p.y;
  let r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
  if (keepRatio && (h.length === 2)) {
    const w = r.w;
    const hh = Math.sign(r.h || 1) * Math.abs(w / keepRatio);
    if (h.includes("n")) r = { ...r, y: y2 - hh, h: hh };
    else r = { ...r, h: hh };
  }
  return r;
}

/** Snap angle to 45° increments (Shift while drawing lines/arrows). */
export function snap45(a: Pt, b: Pt): Pt {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const s = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  return { x: a.x + Math.cos(s) * len, y: a.y + Math.sin(s) * len };
}

/** Douglas–Peucker simplification + light averaging for pencil strokes. */
export function smoothPoints(pts: Pt[], smooth: boolean): Pt[] {
  if (!smooth || pts.length < 4) return pts;
  const avg: Pt[] = pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    return i === 0 || i === pts.length - 1 ? p : { x: (a.x + p.x * 2 + b.x) / 4, y: (a.y + p.y * 2 + b.y) / 4 };
  });
  const eps = 0.6;
  const dp = (s: number, e: number, out: Pt[]) => {
    let maxD = 0;
    let idx = 0;
    for (let i = s + 1; i < e; i++) {
      const d = distSeg(avg[i], avg[s], avg[e]);
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > eps) {
      dp(s, idx, out);
      out.push(avg[idx]);
      dp(idx, e, out);
    }
  };
  const out: Pt[] = [avg[0]];
  dp(0, avg.length - 1, out);
  out.push(avg[avg.length - 1]);
  return out;
}
