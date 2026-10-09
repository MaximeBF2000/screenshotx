import {
  counterLabel,
  clampSpotlightDim,
  DEFAULT_SPOTLIGHT_DIM,
  GRADIENTS,
  type Background,
  type BoxObj,
  type CounterObj,
  type Doc,
  type ImageObj,
  type LineObj,
  type Obj,
  type PathObj,
  type Pt,
  type TextObj,
} from "./types";

export type ImgSrc = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

export interface Env {
  images: Map<string, ImgSrc>;
  drawShadows: boolean;
  /** skip these objects (being edited) */
  hidden?: Set<string>;
  /** balance insets for the background tool, precomputed from pixels */
  balance?: { l: number; t: number; r: number; b: number; color: string } | null;
}

// ---------------------------------------------------------------- layout

export interface Layout {
  outW: number;
  outH: number;
  /** where the canvas rect's top-left lands in output space */
  ox: number;
  oy: number;
  /** content box (canvas + insets) in output space */
  cx: number;
  cy: number;
  cw: number;
  ch: number;
  insetL: number;
  insetT: number;
}

export function layout(doc: Doc, env?: Pick<Env, "balance">): Layout {
  const c = doc.canvas;
  const bg = doc.background;
  if (!bg.enabled) return { outW: c.w, outH: c.h, ox: 0, oy: 0, cx: 0, cy: 0, cw: c.w, ch: c.h, insetL: 0, insetT: 0 };
  const bal = bg.autoBalance && env?.balance ? env.balance : { l: 0, t: 0, r: 0, b: 0 };
  const il = bg.inset + bal.l;
  const it = bg.inset + bal.t;
  const ir = bg.inset + bal.r;
  const ib = bg.inset + bal.b;
  const cw = c.w + il + ir;
  const ch = c.h + it + ib;
  let W = cw + bg.padding * 2;
  let H = ch + bg.padding * 2;
  if (bg.ratio) {
    if (W / H < bg.ratio) W = H * bg.ratio;
    else H = W / bg.ratio;
  }
  const a = bg.align;
  const p = bg.padding;
  const cx = a.includes("l") ? p : a.includes("r") ? W - p - cw : (W - cw) / 2;
  const cy = a.startsWith("t") ? p : a.startsWith("b") ? H - p - ch : (H - ch) / 2;
  return { outW: W, outH: H, ox: cx + il, oy: cy + it, cx, cy, cw, ch, insetL: il, insetT: it };
}

// ---------------------------------------------------------------- helpers

export function gradientById(id: string) {
  return GRADIENTS.find((g) => g.id === id) ?? GRADIENTS[0];
}

function fillGradient(ctx: CanvasRenderingContext2D, id: string, w: number, h: number) {
  const g = gradientById(id);
  const rad = ((g.angle - 90) * Math.PI) / 180;
  const len = Math.abs(w * Math.cos(rad)) + Math.abs(h * Math.sin(rad));
  const cx = w / 2;
  const cy = h / 2;
  const dx = (Math.cos(rad) * len) / 2;
  const dy = (Math.sin(rad) * len) / 2;
  const grad = ctx.createLinearGradient(cx - dx, cy - dy, cx + dx, cy + dy);
  for (const [c, o] of g.stops) grad.addColorStop(o, c);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);
}

function drawCover(ctx: CanvasRenderingContext2D, img: ImgSrc, w: number, h: number) {
  const iw = (img as HTMLImageElement).naturalWidth || img.width;
  const ih = (img as HTMLImageElement).naturalHeight || img.height;
  if (!iw || !ih) return;
  const r = Math.max(w / iw, h / ih);
  const dw = iw * r;
  const dh = ih * r;
  ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
}

/** Parse #RGB, #RRGGBB or #RRGGBBAA into [r, g, b, a(0-1)]. */
export function parseColor(color: string): [number, number, number, number] | null {
  let m = color.trim().replace("#", "");
  if (!/^[0-9a-f]+$/i.test(m)) return null;
  if (m.length === 3) m = m.split("").map((c) => c + c).join("");
  if (m.length !== 6 && m.length !== 8) return null;
  const n = (i: number) => parseInt(m.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), m.length === 8 ? n(6) / 255 : 1];
}

export function isLight(color: string): boolean {
  const c = parseColor(color);
  if (!c) return false;
  // mostly transparent colors read as light (dark text on top)
  if (c[3] < 0.35) return true;
  const m = color.replace("#", "");
  const r = parseInt(m.slice(0, 2), 16);
  const g = parseInt(m.slice(2, 4), 16);
  const b = parseInt(m.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b > 186;
}

function withShadow(ctx: CanvasRenderingContext2D, on: boolean, strength = 1) {
  if (!on) return;
  const k = ctx.getTransform().a; // device px per doc unit
  ctx.shadowColor = `rgba(0,0,0,${0.32 * strength})`;
  ctx.shadowBlur = 6 * k * strength;
  ctx.shadowOffsetY = 1.5 * k * strength;
}

function seeded(seed: string) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  return () => {
    h ^= h << 13;
    h ^= h >>> 17;
    h ^= h << 5;
    return ((h >>> 0) % 10000) / 10000;
  };
}

// ---------------------------------------------------------------- text

export interface TextLayout {
  lines: string[];
  width: number;
  height: number;
  lineHeight: number;
  padX: number;
  padY: number;
  font: string;
}

export function textFont(o: Pick<TextObj, "style" | "fontSize">): string {
  const s = o.fontSize;
  switch (o.style) {
    case 4:
    case 5:
      return `600 ${s}px ui-monospace, "SF Mono", Menlo, monospace`;
    case 6:
      return `700 ${s}px ui-rounded, "SF Pro Rounded", -apple-system, sans-serif`;
    default:
      return `600 ${s}px -apple-system, "SF Pro Text", "Helvetica Neue", sans-serif`;
  }
}

let measureCtx: CanvasRenderingContext2D | null = null;
export function measureText(o: TextObj): TextLayout {
  if (!measureCtx) measureCtx = document.createElement("canvas").getContext("2d")!;
  const ctx = measureCtx;
  const font = textFont(o);
  ctx.font = font;
  const boxed = o.style === 2 || o.style === 3 || o.style === 5;
  const padX = boxed ? o.fontSize * 0.45 : o.style === 1 || o.style === 6 ? o.fontSize * 0.12 : 2;
  const padY = boxed ? o.fontSize * 0.25 : 2;
  const raw = (o.text || " ").split("\n");
  const lines: string[] = [];
  for (const line of raw) {
    if (!o.width) {
      lines.push(line);
      continue;
    }
    const words = line.split(" ");
    let cur = "";
    for (const w of words) {
      const t = cur ? cur + " " + w : w;
      if (ctx.measureText(t).width > o.width - padX * 2 && cur) {
        lines.push(cur);
        cur = w;
      } else cur = t;
    }
    lines.push(cur);
  }
  const lineHeight = o.fontSize * 1.25;
  const tw = Math.max(...lines.map((l) => ctx.measureText(l || " ").width), o.fontSize * 0.5);
  const width = (o.width || tw + padX * 2) + (o.width ? 0 : 0);
  return { lines, width: Math.max(width, tw + padX * 2), height: lines.length * lineHeight + padY * 2, lineHeight, padX, padY, font };
}

function drawText(ctx: CanvasRenderingContext2D, o: TextObj, env: Env) {
  const L = measureText(o);
  const boxed = o.style === 2 || o.style === 3 || o.style === 5;
  ctx.save();
  if (boxed) {
    withShadow(ctx, env.drawShadows && o.shadow);
    ctx.fillStyle = o.color;
    ctx.beginPath();
    const r = o.style === 3 ? Math.min(L.height / 2, o.fontSize * 0.6) : o.fontSize * 0.18;
    ctx.roundRect(o.x, o.y, L.width, L.height, r);
    ctx.fill();
    ctx.shadowColor = "transparent";
  }
  ctx.font = L.font;
  ctx.textBaseline = "middle";
  const textColor = boxed ? (isLight(o.color) ? "#000000" : "#FFFFFF") : o.color;
  L.lines.forEach((line, i) => {
    const y = o.y + L.padY + L.lineHeight * (i + 0.5);
    let x = o.x + L.padX;
    ctx.textAlign = o.align;
    if (o.align === "center") x = o.x + L.width / 2;
    if (o.align === "right") x = o.x + L.width - L.padX;
    if (o.style === 1 || o.style === 6) {
      ctx.lineJoin = "round";
      ctx.strokeStyle = isLight(o.color) ? "#000000" : "#FFFFFF";
      ctx.lineWidth = Math.max(2, o.fontSize * 0.16);
      if (env.drawShadows && o.shadow) withShadow(ctx, true, 0.8);
      ctx.strokeText(line, x, y);
      ctx.shadowColor = "transparent";
    } else if (!boxed) {
      withShadow(ctx, env.drawShadows && o.shadow, 0.6);
    }
    ctx.fillStyle = textColor;
    ctx.fillText(line, x, y);
  });
  ctx.restore();
}

// ---------------------------------------------------------------- shapes

export function arrowHead(o: LineObj) {
  return Math.max(10, o.size * 3.2 + 6);
}

export function curveControl(o: LineObj): Pt {
  if (o.cx !== undefined && o.cy !== undefined) return { x: o.cx, y: o.cy };
  const mx = (o.x1 + o.x2) / 2;
  const my = (o.y1 + o.y2) / 2;
  const dx = o.x2 - o.x1;
  const dy = o.y2 - o.y1;
  return { x: mx - dy * 0.25, y: my + dx * 0.25 };
}

function headPath(ctx: CanvasRenderingContext2D, tip: Pt, angle: number, len: number, width: number) {
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x - len * Math.cos(angle) + (width / 2) * Math.sin(angle), tip.y - len * Math.sin(angle) - (width / 2) * Math.cos(angle));
  ctx.quadraticCurveTo(
    tip.x - len * 0.78 * Math.cos(angle),
    tip.y - len * 0.78 * Math.sin(angle),
    tip.x - len * Math.cos(angle) - (width / 2) * Math.sin(angle),
    tip.y - len * Math.sin(angle) + (width / 2) * Math.cos(angle),
  );
  ctx.closePath();
}

function drawLine(ctx: CanvasRenderingContext2D, o: LineObj, env: Env) {
  ctx.save();
  withShadow(ctx, env.drawShadows && o.shadow);
  ctx.strokeStyle = o.color;
  ctx.fillStyle = o.color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.lineWidth = o.size;
  const a = { x: o.x1, y: o.y1 };
  const b = { x: o.x2, y: o.y2 };
  if (o.type === "line") {
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  const style = o.style ?? "standard";
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const head = Math.min(arrowHead(o), len * 0.6);
  const hw = head * 0.95;
  if (style === "fancy") {
    // tapered body that widens towards a large head
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    const H = Math.min(Math.max(16, o.size * 4.5 + 8), len * 0.7);
    const HW = H * 1.05;
    const body = Math.max(3, o.size * 1.6);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    const base = { x: b.x - H * 0.82 * Math.cos(ang), y: b.y - H * 0.82 * Math.sin(ang) };
    ctx.beginPath();
    ctx.moveTo(a.x + (nx * body) / 6, a.y + (ny * body) / 6);
    ctx.lineTo(base.x + (nx * body) / 2, base.y + (ny * body) / 2);
    ctx.lineTo(b.x - H * Math.cos(ang) + (nx * HW) / 2, b.y - H * Math.sin(ang) + (ny * HW) / 2);
    ctx.lineTo(b.x, b.y);
    ctx.lineTo(b.x - H * Math.cos(ang) - (nx * HW) / 2, b.y - H * Math.sin(ang) - (ny * HW) / 2);
    ctx.lineTo(base.x - (nx * body) / 2, base.y - (ny * body) / 2);
    ctx.lineTo(a.x - (nx * body) / 6, a.y - (ny * body) / 6);
    ctx.arc(a.x, a.y, body / 6, ang + Math.PI / 2, ang - Math.PI / 2);
    ctx.closePath();
    ctx.lineJoin = "round";
    ctx.lineWidth = Math.max(1, o.size * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (style === "curved") {
    const c = curveControl(o);
    const endAng = Math.atan2(b.y - c.y, b.x - c.x);
    // shorten the curve so the stroke does not poke out of the head
    const tEnd = { x: b.x - Math.cos(endAng) * head * 0.7, y: b.y - Math.sin(endAng) * head * 0.7 };
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.quadraticCurveTo(c.x, c.y, tEnd.x, tEnd.y);
    ctx.stroke();
    headPath(ctx, b, endAng, head, hw);
    ctx.fill();
    ctx.restore();
    return;
  }
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const start = style === "double" ? { x: a.x + Math.cos(ang) * head * 0.7, y: a.y + Math.sin(ang) * head * 0.7 } : a;
  const end = { x: b.x - Math.cos(ang) * head * 0.7, y: b.y - Math.sin(ang) * head * 0.7 };
  ctx.beginPath();
  ctx.moveTo(start.x, start.y);
  ctx.lineTo(end.x, end.y);
  ctx.stroke();
  headPath(ctx, b, ang, head, hw);
  ctx.fill();
  if (style === "double") {
    headPath(ctx, a, ang + Math.PI, head, hw);
    ctx.fill();
  }
  ctx.restore();
}

export function smoothPath(ctx: CanvasRenderingContext2D, pts: Pt[]) {
  if (pts.length < 3) {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts) ctx.lineTo(p.x, p.y);
    if (pts.length === 1) ctx.lineTo(pts[0].x + 0.01, pts[0].y);
    return;
  }
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length - 1; i++) {
    const mx = (pts[i].x + pts[i + 1].x) / 2;
    const my = (pts[i].y + pts[i + 1].y) / 2;
    ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
  }
  const last = pts[pts.length - 1];
  ctx.lineTo(last.x, last.y);
}

function drawPath(ctx: CanvasRenderingContext2D, o: PathObj, env: Env) {
  if (!o.points.length) return;
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = o.color;
  if (o.type === "highlighter") {
    // opacity comes from the color itself (#RRGGBBAA, or #RRGGBB at 100%)
    ctx.lineCap = "butt";
    ctx.lineWidth = o.size;
  } else {
    withShadow(ctx, env.drawShadows && o.shadow);
    ctx.lineWidth = o.size;
  }
  ctx.beginPath();
  smoothPath(ctx, o.points);
  ctx.stroke();
  ctx.restore();
}

function drawCounter(ctx: CanvasRenderingContext2D, o: CounterObj, env: Env) {
  const r = counterRadius(o);
  ctx.save();
  withShadow(ctx, env.drawShadows && o.shadow);
  ctx.fillStyle = o.color;
  ctx.beginPath();
  ctx.arc(o.x, o.y, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.lineWidth = Math.max(1.5, r * 0.1);
  ctx.strokeStyle = "rgba(255,255,255,0.9)";
  ctx.stroke();
  const label = counterLabel(o.value, o.style);
  ctx.fillStyle = isLight(o.color) ? "#000" : "#fff";
  const fs = r * (label.length > 2 ? 0.85 : label.length > 1 ? 1.0 : 1.2);
  ctx.font = `700 ${fs}px ui-rounded, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, o.x, o.y + fs * 0.04);
  ctx.restore();
}

export function counterRadius(o: Pick<CounterObj, "size">) {
  return 9 + o.size * 2.4;
}

function drawImageObj(ctx: CanvasRenderingContext2D, o: ImageObj, env: Env) {
  const img = env.images.get(o.src);
  if (!img) return;
  ctx.save();
  withShadow(ctx, env.drawShadows && o.shadow, 1.4);
  ctx.beginPath();
  ctx.roundRect(o.x, o.y, o.w, o.h, 4);
  ctx.fillStyle = "#fff";
  if (o.shadow) ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  ctx.drawImage(img, o.x, o.y, o.w, o.h);
  ctx.restore();
  if (o.border) {
    ctx.save();
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.size;
    ctx.beginPath();
    ctx.roundRect(o.x, o.y, o.w, o.h, 4);
    ctx.stroke();
    ctx.restore();
  }
}

function drawBox(ctx: CanvasRenderingContext2D, o: BoxObj, env: Env) {
  ctx.save();
  const r = Math.min(o.radius ?? 0, Math.abs(o.w) / 2, Math.abs(o.h) / 2);
  if (o.type === "rect" && !o.fill) {
    withShadow(ctx, env.drawShadows && o.shadow);
    ctx.strokeStyle = o.color;
    ctx.lineWidth = o.size;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.roundRect(o.x, o.y, o.w, o.h, r);
    ctx.stroke();
  } else if (o.type === "filledRect" || o.type === "rect") {
    withShadow(ctx, env.drawShadows && o.shadow);
    ctx.fillStyle = o.color;
    ctx.beginPath();
    ctx.roundRect(o.x, o.y, o.w, o.h, r);
    ctx.fill();
  } else if (o.type === "ellipse") {
    withShadow(ctx, env.drawShadows && o.shadow);
    ctx.strokeStyle = o.color;
    ctx.fillStyle = o.color;
    ctx.lineWidth = o.size;
    ctx.beginPath();
    ctx.ellipse(o.x + o.w / 2, o.y + o.h / 2, Math.abs(o.w / 2), Math.abs(o.h / 2), 0, 0, Math.PI * 2);
    if (o.fill) ctx.fill();
    else ctx.stroke();
  } else if (o.type === "highlightRect") {
    ctx.fillStyle = o.color;
    ctx.fillRect(o.x, o.y, o.w, o.h);
  }
  ctx.restore();
}

/** Pixelate / blur / black out the pixels currently under the box. */
function drawRedact(ctx: CanvasRenderingContext2D, o: BoxObj) {
  const style = o.pixelate ?? "pixelate";
  const x = Math.min(o.x, o.x + o.w);
  const y = Math.min(o.y, o.y + o.h);
  const w = Math.abs(o.w);
  const h = Math.abs(o.h);
  if (w < 1 || h < 1) return;
  if (style === "blackout") {
    ctx.save();
    ctx.fillStyle = o.color === "transparent" ? "#000" : o.color;
    ctx.fillRect(x, y, w, h);
    ctx.restore();
    return;
  }
  const m = ctx.getTransform();
  const k = m.a;
  const dx = Math.round(x * k + m.e);
  const dy = Math.round(y * k + m.f);
  const dw = Math.max(1, Math.round(w * k));
  const dh = Math.max(1, Math.round(h * k));
  const cw = ctx.canvas.width;
  const ch = ctx.canvas.height;
  const sx = Math.max(0, dx);
  const sy = Math.max(0, dy);
  const sw = Math.min(cw, dx + dw) - sx;
  const sh = Math.min(ch, dy + dh) - sy;
  if (sw <= 0 || sh <= 0) return;
  let data: ImageData;
  try {
    data = ctx.getImageData(sx, sy, sw, sh);
  } catch {
    return; // tainted canvas: never leak unredacted content, fall back to blackout
  }
  const intensity = Math.max(2, o.intensity ?? 10);
  const tmp = document.createElement("canvas");
  tmp.width = sw;
  tmp.height = sh;
  const t = tmp.getContext("2d")!;
  t.putImageData(data, 0, 0);
  if (style === "pixelate") {
    const block = Math.max(2, Math.round(intensity * 1.2 * k));
    const rnd = seeded(o.id);
    const d = data.data;
    for (let by = 0; by < sh; by += block) {
      for (let bx = 0; bx < sw; bx += block) {
        let r = 0, g = 0, b = 0, n = 0;
        const ex = Math.min(bx + block, sw);
        const ey = Math.min(by + block, sh);
        for (let yy = by; yy < ey; yy += 2) {
          for (let xx = bx; xx < ex; xx += 2) {
            const i = (yy * sw + xx) * 4;
            r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
          }
        }
        // randomized offset so the original can't be reconstructed
        const j = (rnd() - 0.5) * 26;
        t.fillStyle = `rgb(${Math.min(255, Math.max(0, r / n + j))},${Math.min(255, Math.max(0, g / n + j))},${Math.min(255, Math.max(0, b / n + j))})`;
        t.fillRect(bx, by, ex - bx, ey - by);
      }
    }
  } else {
    // blur by repeated down/up-scaling; "secure" first destroys detail
    const passes = style === "blur" ? 3 : 2;
    const factor = Math.max(2, Math.round(intensity * (style === "blur" ? 0.9 : 0.6)));
    const small = document.createElement("canvas");
    small.width = Math.max(1, Math.round(sw / factor));
    small.height = Math.max(1, Math.round(sh / factor));
    const s = small.getContext("2d")!;
    s.imageSmoothingEnabled = true;
    s.imageSmoothingQuality = "high";
    for (let i = 0; i < passes; i++) {
      s.clearRect(0, 0, small.width, small.height);
      s.drawImage(tmp, 0, 0, small.width, small.height);
      t.clearRect(0, 0, sw, sh);
      t.imageSmoothingEnabled = true;
      t.imageSmoothingQuality = "high";
      t.drawImage(small, 0, 0, sw, sh);
    }
    if (style === "blur") {
      const rnd = seeded(o.id);
      t.globalAlpha = 0.06;
      for (let i = 0; i < 40; i++) {
        t.fillStyle = rnd() > 0.5 ? "#fff" : "#000";
        t.fillRect(rnd() * sw, rnd() * sh, rnd() * sw * 0.3, rnd() * sh * 0.3);
      }
      t.globalAlpha = 1;
    }
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(tmp, sx, sy);
  ctx.restore();
}

function drawSpotlights(ctx: CanvasRenderingContext2D, doc: Doc, spots: BoxObj[]) {
  const m = ctx.getTransform();
  const c = doc.canvas;
  const off = document.createElement("canvas");
  off.width = ctx.canvas.width;
  off.height = ctx.canvas.height;
  const o = off.getContext("2d")!;
  o.setTransform(m);
  o.fillStyle = `rgba(0,0,0,${clampSpotlightDim(doc.spotlightDim ?? DEFAULT_SPOTLIGHT_DIM)})`;
  o.fillRect(c.x, c.y, c.w, c.h);
  o.globalCompositeOperation = "destination-out";
  o.fillStyle = "#000";
  for (const s of spots) {
    o.beginPath();
    if (s.shape === "ellipse") o.ellipse(s.x + s.w / 2, s.y + s.h / 2, Math.abs(s.w / 2), Math.abs(s.h / 2), 0, 0, Math.PI * 2);
    else o.roundRect(s.x, s.y, s.w, s.h, 6);
    o.fill();
  }
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(off, 0, 0);
  ctx.restore();
}

export function drawObject(ctx: CanvasRenderingContext2D, o: Obj, env: Env) {
  switch (o.type) {
    case "rect":
    case "filledRect":
    case "ellipse":
    case "highlightRect":
      drawBox(ctx, o, env);
      break;
    case "pixelate":
      drawRedact(ctx, o);
      break;
    case "line":
    case "arrow":
      drawLine(ctx, o, env);
      break;
    case "pen":
    case "highlighter":
      drawPath(ctx, o, env);
      break;
    case "text":
      drawText(ctx, o, env);
      break;
    case "counter":
      drawCounter(ctx, o, env);
      break;
    case "image":
      drawImageObj(ctx, o, env);
      break;
  }
}

/** Draw base image + objects in doc space (ctx maps doc → device). */
export function renderContent(ctx: CanvasRenderingContext2D, doc: Doc, env: Env) {
  renderBase(ctx, doc, env);
  renderObjects(ctx, doc, env);
}

export function renderBase(ctx: CanvasRenderingContext2D, doc: Doc, env: Env) {
  const base = env.images.get(doc.base);
  if (base) ctx.drawImage(base, 0, 0, doc.baseW, doc.baseH);
}

export function renderObjects(ctx: CanvasRenderingContext2D, doc: Doc, env: Env) {
  const spots = doc.objects.filter((o) => o.type === "spotlight" && !env.hidden?.has(o.id)) as BoxObj[];
  let spotsDone = false;
  for (const o of doc.objects) {
    if (env.hidden?.has(o.id)) continue;
    if (o.type === "spotlight") {
      if (!spotsDone) {
        drawSpotlights(ctx, doc, spots);
        spotsDone = true;
      }
      continue;
    }
    drawObject(ctx, o, env);
  }
}

function drawBackground(ctx: CanvasRenderingContext2D, bg: Background, L: Layout, env: Env) {
  ctx.save();
  if (bg.kind === "gradient") fillGradient(ctx, bg.value, L.outW, L.outH);
  else if (bg.kind === "color") {
    ctx.fillStyle = bg.value;
    ctx.fillRect(0, 0, L.outW, L.outH);
  } else {
    const img = env.images.get(bg.kind === "image" ? bg.value : bg.kind);
    if (img) drawCover(ctx, img, L.outW, L.outH);
    else {
      ctx.fillStyle = "#888";
      ctx.fillRect(0, 0, L.outW, L.outH);
    }
  }
  ctx.restore();
}

/**
 * Render the whole document (background + content) into `ctx`, where
 * `k` is device pixels per doc point. Returns the layout used.
 */
export function renderDoc(ctx: CanvasRenderingContext2D, doc: Doc, env: Env, k: number): Layout {
  const L = layout(doc, env);
  const bg = doc.background;
  const c = doc.canvas;
  ctx.save();
  ctx.setTransform(k, 0, 0, k, 0, 0);
  ctx.clearRect(0, 0, L.outW, L.outH);
  if (bg.enabled) {
    drawBackground(ctx, bg, L, env);
    const r = bg.radius;
    if (bg.shadow > 0) {
      ctx.save();
      ctx.shadowColor = `rgba(0,0,0,${0.18 + bg.shadow / 300})`;
      ctx.shadowBlur = bg.shadow * 0.7 * k;
      ctx.shadowOffsetY = bg.shadow * 0.22 * k;
      ctx.fillStyle = "#000";
      ctx.beginPath();
      ctx.roundRect(L.cx, L.cy, L.cw, L.ch, r);
      ctx.fill();
      ctx.restore();
    }
    // the screenshot card: inset area + the image itself, both rounded
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(L.cx, L.cy, L.cw, L.ch, r);
    ctx.clip();
    const inset = L.cw - c.w > 0.5 || L.ch - c.h > 0.5;
    if (inset) {
      ctx.fillStyle = bg.insetColor || env.balance?.color || "#fff";
      ctx.fillRect(L.cx, L.cy, L.cw, L.ch);
      // concentric corner radius for the image inside the inset
      const ir = Math.max(r * 0.5, r - Math.min(L.ox - L.cx, L.oy - L.cy));
      ctx.beginPath();
      ctx.roundRect(L.ox, L.oy, c.w, c.h, ir);
      ctx.clip();
    }
    ctx.translate(L.ox - c.x, L.oy - c.y);
    renderBase(ctx, doc, env);
    ctx.restore();
    // annotations float over everything: they may sit in the padding and
    // never change the background layout
    ctx.translate(L.ox - c.x, L.oy - c.y);
    renderObjects(ctx, doc, env);
  } else {
    ctx.translate(-c.x, -c.y);
    ctx.beginPath();
    ctx.rect(c.x, c.y, c.w, c.h);
    ctx.clip();
    renderContent(ctx, doc, env);
  }
  ctx.restore();
  return L;
}

/** Edge color + insets that visually center the content (Auto Balance). */
export function computeBalance(base: ImgSrc, doc: Doc): Env["balance"] {
  const c = doc.canvas;
  const s = doc.scale;
  const w = Math.max(1, Math.round(c.w * s));
  const h = Math.max(1, Math.round(c.h * s));
  const maxSide = 600;
  const r = Math.min(1, maxSide / Math.max(w, h));
  const cw = Math.max(1, Math.round(w * r));
  const chh = Math.max(1, Math.round(h * r));
  const cv = document.createElement("canvas");
  cv.width = cw;
  cv.height = chh;
  const ctx = cv.getContext("2d", { willReadFrequently: true })!;
  try {
    ctx.drawImage(base, c.x * s, c.y * s, w, h, 0, 0, cw, chh);
    const d = ctx.getImageData(0, 0, cw, chh).data;
    // edge color = average of the border pixels
    let R = 0, G = 0, B = 0, n = 0;
    const px = (x: number, y: number) => (y * cw + x) * 4;
    for (let x = 0; x < cw; x++) for (const y of [0, chh - 1]) { const i = px(x, y); R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    for (let y = 0; y < chh; y++) for (const x of [0, cw - 1]) { const i = px(x, y); R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    R /= n; G /= n; B /= n;
    const diff = (i: number) => Math.abs(d[i] - R) + Math.abs(d[i + 1] - G) + Math.abs(d[i + 2] - B) > 40;
    let minX = cw, minY = chh, maxX = -1, maxY = -1;
    for (let y = 0; y < chh; y++) {
      for (let x = 0; x < cw; x++) {
        if (diff(px(x, y))) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    const color = `rgb(${Math.round(R)},${Math.round(G)},${Math.round(B)})`;
    if (maxX < 0) return { l: 0, t: 0, r: 0, b: 0, color };
    const toPt = (v: number) => v / r / s;
    const ml = toPt(minX);
    const mr = toPt(cw - 1 - maxX);
    const mt = toPt(minY);
    const mb = toPt(chh - 1 - maxY);
    const mx = Math.max(ml, mr);
    const my = Math.max(mt, mb);
    return { l: mx - ml, r: mx - mr, t: my - mt, b: my - mb, color };
  } catch {
    return null;
  }
}

/** Render to an offscreen canvas at `scale` px/pt and return PNG bytes. */
export async function exportPng(doc: Doc, env: Env, scale = doc.scale): Promise<Uint8Array> {
  const L = layout(doc, env);
  const cv = document.createElement("canvas");
  cv.width = Math.max(1, Math.round(L.outW * scale));
  cv.height = Math.max(1, Math.round(L.outH * scale));
  const ctx = cv.getContext("2d")!;
  ctx.imageSmoothingQuality = "high";
  renderDoc(ctx, doc, env, scale);
  const blob: Blob = await new Promise((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error("toBlob failed"))), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}

/** Render a single object to PNG (Copy Object to Clipboard). */
export async function exportObjectPng(doc: Doc, env: Env, o: Obj, bounds: { x: number; y: number; w: number; h: number }): Promise<Uint8Array> {
  const s = doc.scale;
  const pad = 12;
  const cv = document.createElement("canvas");
  cv.width = Math.round((bounds.w + pad * 2) * s);
  cv.height = Math.round((bounds.h + pad * 2) * s);
  const ctx = cv.getContext("2d")!;
  ctx.setTransform(s, 0, 0, s, (-bounds.x + pad) * s, (-bounds.y + pad) * s);
  if (o.type === "pixelate") {
    const base = env.images.get(doc.base);
    if (base) ctx.drawImage(base, 0, 0, doc.baseW, doc.baseH);
  }
  drawObject(ctx, o, env);
  const blob: Blob = await new Promise((res) => cv.toBlob((b) => res(b!), "image/png"));
  return new Uint8Array(await blob.arrayBuffer());
}
