import { create } from "zustand";
import { bounds, contentBounds, mapObj, translate, union } from "./geom";
import { renderContent, type ImgSrc } from "./render";
import {
  DEFAULT_TOOL_SETTINGS,
  uid,
  type Background,
  type CanvasRect,
  type Doc,
  type Obj,
  type Tool,
  type ToolSettings,
} from "./types";

interface State {
  doc: Doc | null;
  original: Doc | null;
  images: Map<string, ImgSrc>;
  imagesVersion: number;
  tool: Tool;
  ts: ToolSettings;
  selected: string[];
  past: Doc[];
  future: Doc[];
  zoom: number;
  fitMode: boolean;
  crop: CanvasRect | null;
  cropRatio: number | null;
  editingText: string | null;
  bgPanel: boolean;
  dirty: boolean;
  autoExpand: boolean;
  clipboard: Obj[];

  init: (doc: Doc, images: Map<string, ImgSrc>) => void;
  addImage: (key: string, img: ImgSrc) => void;
  setTool: (t: Tool) => void;
  setTs: (patch: Partial<ToolSettings>) => void;
  select: (ids: string[]) => void;
  commit: (doc: Doc) => void;
  setDocLive: (doc: Doc) => void;
  pushHistory: () => void;
  add: (o: Obj) => void;
  update: (id: string, patch: Partial<Obj>, history?: boolean) => void;
  removeSelected: () => void;
  duplicateSelected: () => void;
  nudge: (dx: number, dy: number) => void;
  arrange: (where: "front" | "back" | "forward" | "backward") => void;
  undo: () => void;
  redo: () => void;
  setZoom: (z: number, fit?: boolean) => void;
  setBackground: (patch: Partial<Background>) => void;
  setCanvas: (r: CanvasRect) => void;
  expandToFit: () => void;
  transform: (kind: "rotateL" | "rotateR" | "flipH" | "flipV") => void;
  resize: (w: number, h: number) => void;
  flatten: () => void;
  revert: () => void;
  copySelection: () => void;
  pasteObjects: () => void;
}

function snapshot(d: Doc): Doc {
  return { ...d, canvas: { ...d.canvas }, objects: d.objects.slice(), background: { ...d.background } };
}

function newCanvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

export const useAnnotate = create<State>((set, get) => ({
  doc: null,
  original: null,
  images: new Map(),
  imagesVersion: 0,
  tool: "arrow",
  ts: DEFAULT_TOOL_SETTINGS,
  selected: [],
  past: [],
  future: [],
  zoom: 1,
  fitMode: true,
  crop: null,
  cropRatio: null,
  editingText: null,
  bgPanel: false,
  dirty: false,
  autoExpand: true,
  clipboard: [],

  init: (doc, images) => set({ doc, original: snapshot(doc), images, past: [], future: [], selected: [], dirty: false, imagesVersion: get().imagesVersion + 1 }),
  addImage: (key, img) => {
    get().images.set(key, img);
    set({ imagesVersion: get().imagesVersion + 1 });
  },
  setTool: (t) => {
    const st = get();
    if (t === "crop" && st.doc) set({ crop: { ...st.doc.canvas }, selected: [] });
    else if (st.tool === "crop") set({ crop: null });
    if (t === "background") {
      set({ bgPanel: !st.bgPanel });
      if (st.doc && !st.doc.background.enabled && !st.bgPanel) st.setBackground({ enabled: true });
      return;
    }
    set({ tool: t, editingText: null, selected: t === "move" ? st.selected : [] });
  },
  setTs: (patch) => {
    const st = get();
    set({ ts: { ...st.ts, ...patch } });
    // changing a property applies it to the current selection, like CleanShot
    if (st.doc && st.selected.length) {
      const map: Record<string, string> = { fill: "fill", highlightColor: "color", color: "color", size: "size", shadow: "shadow", arrowStyle: "style", textStyle: "style", fontSize: "fontSize", textAlign: "align", pixelate: "pixelate", intensity: "intensity", spotlightShape: "shape", counterStyle: "style", rectRadius: "radius" };
      const objects = st.doc.objects.map((o) => {
        if (!st.selected.includes(o.id)) return o;
        const p: any = {};
        for (const [k, v] of Object.entries(patch)) {
          const field = map[k];
          if (!field) continue;
          if (k === "arrowStyle" && o.type !== "arrow") continue;
          if (k === "textStyle" && o.type !== "text") continue;
          if (k === "counterStyle" && o.type !== "counter") continue;
          if ((k === "pixelate" || k === "intensity") && o.type !== "pixelate") continue;
          if (k === "spotlightShape" && o.type !== "spotlight") continue;
          if ((k === "fontSize" || k === "textAlign") && o.type !== "text") continue;
          if (k === "rectRadius" && o.type !== "rect" && o.type !== "filledRect") continue;
          if (k === "fill" && o.type !== "rect" && o.type !== "ellipse" && o.type !== "filledRect") continue;
          if (k === "highlightColor") {
            if (o.type !== "highlighter" && o.type !== "highlightRect") continue;
            p.color = v;
            continue;
          }
          if (k === "color" && (o.type === "highlighter" || o.type === "highlightRect")) continue;
          if (k === "size" && o.type === "text") {
            p.fontSize = Math.max(8, (v as number) * 5 + 6);
            continue;
          }
          p[field] = v;
        }
        return { ...o, ...p } as Obj;
      });
      get().commit({ ...st.doc, objects });
    }
  },
  select: (ids) => set({ selected: ids }),
  pushHistory: () => {
    const st = get();
    if (!st.doc) return;
    set({ past: [...st.past.slice(-80), snapshot(st.doc)], future: [], dirty: true });
  },
  commit: (doc) => {
    const st = get();
    if (!st.doc) return;
    set({ past: [...st.past.slice(-80), snapshot(st.doc)], future: [], doc, dirty: true });
  },
  setDocLive: (doc) => set({ doc }),
  add: (o) => {
    const st = get();
    if (!st.doc) return;
    st.commit({ ...st.doc, objects: [...st.doc.objects, o] });
    if (get().autoExpand) get().expandToFit();
  },
  update: (id, patch, history = true) => {
    const st = get();
    if (!st.doc) return;
    const doc = { ...st.doc, objects: st.doc.objects.map((o) => (o.id === id ? ({ ...o, ...patch } as Obj) : o)) };
    if (history) st.commit(doc);
    else set({ doc });
  },
  removeSelected: () => {
    const st = get();
    if (!st.doc || !st.selected.length) return;
    st.commit({ ...st.doc, objects: st.doc.objects.filter((o) => !st.selected.includes(o.id)) });
    set({ selected: [] });
  },
  duplicateSelected: () => {
    const st = get();
    if (!st.doc || !st.selected.length) return;
    const copies = st.doc.objects.filter((o) => st.selected.includes(o.id)).map((o) => ({ ...translate(o, 16, 16), id: uid() }) as Obj);
    st.commit({ ...st.doc, objects: [...st.doc.objects, ...copies] });
    set({ selected: copies.map((c) => c.id) });
  },
  nudge: (dx, dy) => {
    const st = get();
    if (!st.doc || !st.selected.length) return;
    st.commit({ ...st.doc, objects: st.doc.objects.map((o) => (st.selected.includes(o.id) ? translate(o, dx, dy) : o)) });
  },
  arrange: (where) => {
    const st = get();
    if (!st.doc || !st.selected.length) return;
    const sel = st.doc.objects.filter((o) => st.selected.includes(o.id));
    const rest = st.doc.objects.filter((o) => !st.selected.includes(o.id));
    let objects: Obj[];
    if (where === "front") objects = [...rest, ...sel];
    else if (where === "back") objects = [...sel, ...rest];
    else {
      objects = st.doc.objects.slice();
      const step = where === "forward" ? 1 : -1;
      const idxs = objects.map((o, i) => (st.selected.includes(o.id) ? i : -1)).filter((i) => i >= 0);
      if (step > 0) idxs.reverse();
      for (const i of idxs) {
        const j = i + step;
        if (j < 0 || j >= objects.length) continue;
        [objects[i], objects[j]] = [objects[j], objects[i]];
      }
    }
    st.commit({ ...st.doc, objects });
  },
  undo: () => {
    const st = get();
    if (!st.past.length || !st.doc) return;
    const prev = st.past[st.past.length - 1];
    set({ past: st.past.slice(0, -1), future: [snapshot(st.doc), ...st.future], doc: prev, selected: [], dirty: true });
  },
  redo: () => {
    const st = get();
    if (!st.future.length || !st.doc) return;
    const next = st.future[0];
    set({ future: st.future.slice(1), past: [...st.past, snapshot(st.doc)], doc: next, selected: [], dirty: true });
  },
  setZoom: (z, fit = false) => set({ zoom: Math.min(8, Math.max(0.05, z)), fitMode: fit }),
  setBackground: (patch) => {
    const st = get();
    if (!st.doc) return;
    let canvas = st.doc.canvas;
    if (patch.enabled && !st.doc.background.enabled) {
      // frame the original image, not area added by auto-expansion
      const d = st.doc;
      const x = Math.max(canvas.x, 0);
      const y = Math.max(canvas.y, 0);
      const x2 = Math.min(canvas.x + canvas.w, d.baseW);
      const y2 = Math.min(canvas.y + canvas.h, d.baseH);
      if (x2 - x > 8 && y2 - y > 8) canvas = { x, y, w: x2 - x, h: y2 - y };
    }
    st.commit({ ...st.doc, canvas, background: { ...st.doc.background, ...patch } });
  },
  setCanvas: (r) => {
    const st = get();
    if (!st.doc) return;
    st.commit({ ...st.doc, canvas: r });
  },
  expandToFit: () => {
    const st = get();
    // with a background, annotations may live in the padding without
    // changing the layout
    if (!st.doc || st.doc.background.enabled) return;
    const cb = contentBounds(st.doc);
    if (!cb) return;
    const c = st.doc.canvas;
    const u = union(c, { x: Math.floor(cb.x), y: Math.floor(cb.y), w: Math.ceil(cb.w), h: Math.ceil(cb.h) });
    if (u.x < c.x || u.y < c.y || u.w > c.w || u.h > c.h) {
      set({ doc: { ...st.doc, canvas: u } });
    }
  },
  transform: (kind) => {
    const st = get();
    const d = st.doc;
    if (!d) return;
    const base = st.images.get(d.base);
    if (!base) return;
    const pw = Math.round(d.baseW * d.scale);
    const ph = Math.round(d.baseH * d.scale);
    const rot = kind === "rotateL" || kind === "rotateR";
    const c = newCanvas(rot ? ph : pw, rot ? pw : ph);
    const ctx = c.getContext("2d")!;
    if (kind === "rotateR") ctx.setTransform(0, 1, -1, 0, ph, 0);
    if (kind === "rotateL") ctx.setTransform(0, -1, 1, 0, 0, pw);
    if (kind === "flipH") ctx.setTransform(-1, 0, 0, 1, pw, 0);
    if (kind === "flipV") ctx.setTransform(1, 0, 0, -1, 0, ph);
    ctx.drawImage(base, 0, 0, pw, ph);
    const key = "base-" + uid();
    st.images.set(key, c);
    const W = d.baseW;
    const H = d.baseH;
    const f = (p: { x: number; y: number }) => {
      switch (kind) {
        case "rotateR":
          return { x: H - p.y, y: p.x };
        case "rotateL":
          return { x: p.y, y: W - p.x };
        case "flipH":
          return { x: W - p.x, y: p.y };
        default:
          return { x: p.x, y: H - p.y };
      }
    };
    const cv = d.canvas;
    const p1 = f({ x: cv.x, y: cv.y });
    const p2 = f({ x: cv.x + cv.w, y: cv.y + cv.h });
    st.commit({
      ...d,
      base: key,
      baseW: rot ? H : W,
      baseH: rot ? W : H,
      canvas: { x: Math.min(p1.x, p2.x), y: Math.min(p1.y, p2.y), w: Math.abs(p2.x - p1.x), h: Math.abs(p2.y - p1.y) },
      objects: d.objects.map((o) => mapObj(o, f)),
    });
    set({ imagesVersion: st.imagesVersion + 1 });
  },
  resize: (w, h) => {
    const st = get();
    const d = st.doc;
    if (!d) return;
    // resizing flattens the annotations into the image (can't be undone in CleanShot; here it can)
    const kx = w / d.canvas.w;
    const ky = h / d.canvas.h;
    const flat = flattenCanvas(d, st.images);
    const c = newCanvas(w * d.scale, h * d.scale);
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(flat, 0, 0, c.width, c.height);
    const key = "base-" + uid();
    st.images.set(key, c);
    void kx;
    void ky;
    st.commit({ ...d, base: key, baseW: w, baseH: h, canvas: { x: 0, y: 0, w, h }, objects: [] });
    set({ imagesVersion: st.imagesVersion + 1, selected: [] });
  },
  flatten: () => {
    const st = get();
    const d = st.doc;
    if (!d) return;
    const flat = flattenCanvas(d, st.images);
    const key = "base-" + uid();
    st.images.set(key, flat);
    st.commit({ ...d, base: key, baseW: d.canvas.w, baseH: d.canvas.h, canvas: { x: 0, y: 0, w: d.canvas.w, h: d.canvas.h }, objects: [] });
    set({ imagesVersion: st.imagesVersion + 1, selected: [] });
  },
  revert: () => {
    const st = get();
    if (!st.original) return;
    st.commit(snapshot(st.original));
    set({ selected: [] });
  },
  copySelection: () => {
    const st = get();
    if (!st.doc) return;
    set({ clipboard: st.doc.objects.filter((o) => st.selected.includes(o.id)) });
  },
  pasteObjects: () => {
    const st = get();
    if (!st.doc || !st.clipboard.length) return;
    const copies = st.clipboard.map((o) => ({ ...translate(o, 20, 20), id: uid() }) as Obj);
    st.commit({ ...st.doc, objects: [...st.doc.objects, ...copies] });
    set({ selected: copies.map((c) => c.id), clipboard: copies });
  },
}));

/** Render canvas content (no background) at the doc scale into a new canvas. */
export function flattenCanvas(d: Doc, images: Map<string, ImgSrc>): HTMLCanvasElement {
  const c = newCanvas(d.canvas.w * d.scale, d.canvas.h * d.scale);
  const ctx = c.getContext("2d")!;
  ctx.setTransform(d.scale, 0, 0, d.scale, -d.canvas.x * d.scale, -d.canvas.y * d.scale);
  renderContent(ctx, d, { images, drawShadows: true });
  return c;
}

export function selectionBounds(doc: Doc, ids: string[]) {
  const objs = doc.objects.filter((o) => ids.includes(o.id));
  if (!objs.length) return null;
  return objs.map(bounds).reduce(union);
}

if (import.meta.env.DEV) (window as any).__annotate = useAnnotate;
