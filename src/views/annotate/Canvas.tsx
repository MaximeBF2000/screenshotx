import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAnnotate, selectionBounds } from "./store";
import { computeBalance, layout, measureText, renderDoc, textFont, isLight, type Env } from "./render";
import { bounds, handles, norm, resizeBox, smoothPoints, snap45, topHit, translate, type HandleId } from "./geom";
import { uid, type BoxObj, type LineObj, type Obj, type PathObj, type Pt, type TextObj } from "./types";
import { useSettings } from "../../lib/settings";

type Drag =
  | { kind: "create"; id: string; start: Pt }
  | { kind: "move"; start: Pt; orig: Obj[] }
  | { kind: "handle"; id: string; handle: HandleId; orig: Obj }
  | { kind: "marquee"; start: Pt; cur: Pt }
  | { kind: "pan"; sx: number; sy: number; scrollX: number; scrollY: number }
  | { kind: "crop"; handle: HandleId | "move" | "new"; start: Pt; orig: { x: number; y: number; w: number; h: number } };

export function AnnotateCanvas() {
  const st = useAnnotate();
  const { doc, zoom, tool, ts, selected, crop } = st;
  const settings = useSettings((s) => s.settings);
  const viewport = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drag = useRef<Drag | null>(null);
  const [marquee, setMarquee] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [space, setSpace] = useState(false);
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [vp, setVp] = useState({ w: 800, h: 600 });
  const drawShadows = settings?.annotateDrawShadow ?? true;
  const inverseArrow = settings?.annotateInverseArrow ?? false;
  const smooth = settings?.annotateSmoothDrawing ?? true;

  const balance = useMemo(() => {
    // edge color for the inset + balance offsets for Auto Balance
    if (!doc || !doc.background.enabled || (!doc.background.autoBalance && doc.background.inset <= 0)) return null;
    const base = st.images.get(doc.base);
    return base ? computeBalance(base, doc) : null;
  }, [doc?.base, doc?.canvas, doc?.background.enabled, doc?.background.autoBalance, (doc?.background.inset ?? 0) > 0, st.imagesVersion]);

  const env: Env = useMemo(
    () => ({ images: st.images, drawShadows, balance, hidden: st.editingText ? new Set([st.editingText]) : undefined }),
    [st.images, st.imagesVersion, drawShadows, balance, st.editingText],
  );
  const L = doc ? layout(doc, env) : null;

  // viewport size → fit zoom
  useLayoutEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setVp({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setVp({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    if (!L || !st.fitMode) return;
    const pad = 48;
    const z = Math.min(1, (vp.w - pad * 2) / L.outW, (vp.h - pad * 2) / L.outH);
    if (Math.abs(z - zoom) > 0.001) st.setZoom(z, true);
  }, [L?.outW, L?.outH, vp.w, vp.h, st.fitMode]);

  // render
  useEffect(() => {
    const c = canvasRef.current;
    if (!c || !doc || !L) return;
    const dpr = window.devicePixelRatio || 2;
    const k = zoom * dpr;
    c.width = Math.max(1, Math.round(L.outW * k));
    c.height = Math.max(1, Math.round(L.outH * k));
    const ctx = c.getContext("2d", { willReadFrequently: false })!;
    ctx.imageSmoothingQuality = "high";
    renderDoc(ctx, doc, env, k);
  }, [doc, zoom, env, L?.outW, L?.outH]);

  const toDoc = useCallback(
    (e: { clientX: number; clientY: number }): Pt => {
      const r = canvasRef.current!.getBoundingClientRect();
      const lx = (e.clientX - r.left) / zoom;
      const ly = (e.clientY - r.top) / zoom;
      return { x: lx - L!.ox + doc!.canvas.x, y: ly - L!.oy + doc!.canvas.y };
    },
    [zoom, L, doc],
  );

  // space-to-pan
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === "Space" && !st.editingText && !(e.target as HTMLElement).closest("input, textarea, [contenteditable=true]")) {
        e.preventDefault();
        setSpace(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === "Space" && setSpace(false);
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [st.editingText]);

  // pinch / ⌘-scroll zoom around the cursor
  useEffect(() => {
    const el = viewport.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const z0 = useAnnotate.getState().zoom;
      const z1 = Math.min(8, Math.max(0.05, z0 * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.003))));
      const rect = el.getBoundingClientRect();
      const mx = e.clientX - rect.left + el.scrollLeft;
      const my = e.clientY - rect.top + el.scrollTop;
      useAnnotate.getState().setZoom(z1, false);
      requestAnimationFrame(() => {
        el.scrollLeft = (mx * z1) / z0 - (e.clientX - rect.left);
        el.scrollTop = (my * z1) / z0 - (e.clientY - rect.top);
      });
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  if (!doc || !L) return <div ref={viewport} className="flex-1" />;

  const tol = 5 / zoom;
  const counterNext = () => Math.max(0, ...doc.objects.filter((o) => o.type === "counter").map((o) => (o as any).value)) + 1;

  const startText = (p: Pt, existing?: TextObj) => {
    if (existing) {
      st.select([existing.id]);
      useAnnotate.setState({ editingText: existing.id });
      return;
    }
    const o: TextObj = {
      id: uid(),
      type: "text",
      x: p.x,
      y: p.y - ts.fontSize * 0.75,
      text: "",
      style: ts.textStyle,
      fontSize: ts.fontSize,
      align: ts.textAlign,
      width: 0,
      color: ts.color,
      size: ts.size,
      shadow: ts.shadow,
    };
    st.add(o);
    st.select([o.id]);
    useAnnotate.setState({ editingText: o.id });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const target = e.target as HTMLElement;
    if (target.closest("[data-texteditor]")) return;
    if (st.editingText) {
      // clicking outside ends text editing
      (document.activeElement as HTMLElement)?.blur?.();
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (space || e.button === 1) {
      const el = viewport.current!;
      drag.current = { kind: "pan", sx: e.clientX, sy: e.clientY, scrollX: el.scrollLeft, scrollY: el.scrollTop };
      return;
    }
    const p = toDoc(e);

    if (tool === "crop" && crop) {
      const h = target.dataset.crophandle as HandleId | undefined;
      const inside = p.x >= crop.x && p.x <= crop.x + crop.w && p.y >= crop.y && p.y <= crop.y + crop.h;
      drag.current = { kind: "crop", handle: h ?? (inside ? "move" : "new"), start: p, orig: { ...crop } };
      if (!h && !inside) useAnnotate.setState({ crop: { x: p.x, y: p.y, w: 0, h: 0 } });
      return;
    }

    const handle = target.dataset.handle as HandleId | undefined;
    if (handle && selected.length === 1) {
      const o = doc.objects.find((x) => x.id === selected[0]);
      if (o) {
        st.pushHistory();
        drag.current = { kind: "handle", id: o.id, handle, orig: o };
        return;
      }
    }

    // existing objects: anything when moving; only the stroke for hollow shapes with drawing tools
    const strict = tool !== "move";
    const h = topHit(doc.objects, p, tol, strict);
    if (h && !(tool === "counter" && h.type !== "counter" && !e.altKey)) {
      if ((e.detail === 2 || tool === "text") && h.type === "text" && selected.includes(h.id)) {
        e.preventDefault();
        startText(p, h);
        return;
      }
      const ids = e.shiftKey ? Array.from(new Set([...selected, h.id])) : selected.includes(h.id) ? selected : [h.id];
      st.select(ids);
      st.pushHistory();
      let objs = doc.objects;
      if (e.altKey) {
        // ⌥-drag duplicates
        const copies = doc.objects.filter((o) => ids.includes(o.id)).map((o) => ({ ...o, id: uid() }) as Obj);
        objs = [...doc.objects, ...copies];
        st.setDocLive({ ...doc, objects: objs });
        st.select(copies.map((c) => c.id));
        drag.current = { kind: "move", start: p, orig: copies };
        return;
      }
      drag.current = { kind: "move", start: p, orig: objs.filter((o) => ids.includes(o.id)) };
      return;
    }

    if (tool === "move") {
      st.select([]);
      drag.current = { kind: "marquee", start: p, cur: p };
      return;
    }
    if (tool === "text") {
      e.preventDefault(); // keep focus on the new text editor
      startText(p);
      return;
    }
    if (tool === "counter") {
      st.add({ id: uid(), type: "counter", x: p.x, y: p.y, value: counterNext(), style: ts.counterStyle, color: ts.color, size: ts.size, shadow: ts.shadow });
      return;
    }

    // create a new shape
    st.select([]);
    const id = uid();
    const base = { id, color: ts.color, size: ts.size, shadow: ts.shadow };
    let o: Obj | null = null;
    switch (tool) {
      case "rect":
      case "ellipse":
        o = { ...base, type: tool, x: p.x, y: p.y, w: 0, h: 0, fill: ts.fill, radius: tool === "ellipse" ? 0 : ts.rectRadius } as BoxObj;
        break;
      case "pixelate":
        o = { ...base, type: "pixelate", x: p.x, y: p.y, w: 0, h: 0, pixelate: ts.pixelate === "blackout" ? "pixelate" : ts.pixelate, intensity: ts.intensity } as BoxObj;
        break;
      case "spotlight":
        o = { ...base, type: "spotlight", x: p.x, y: p.y, w: 0, h: 0, shape: ts.spotlightShape } as BoxObj;
        break;
      case "highlighter":
        o =
          ts.highlightShape === "rect"
            ? ({ ...base, color: ts.highlightColor, type: "highlightRect", x: p.x, y: p.y, w: 0, h: 0 } as BoxObj)
            : ({ ...base, color: ts.highlightColor, type: "highlighter", size: Math.max(10, ts.size * 4 + 6), points: [p] } as PathObj);
        break;
      case "pen":
        o = { ...base, type: "pen", points: [p] } as PathObj;
        break;
      case "line":
      case "arrow":
        o = { ...base, type: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, style: tool === "arrow" ? ts.arrowStyle : undefined } as LineObj;
        break;
    }
    if (!o) return;
    st.pushHistory();
    st.setDocLive({ ...doc, objects: [...doc.objects, o] });
    drag.current = { kind: "create", id, start: p };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    const p = toDoc(e);
    if (!d) {
      const h = topHit(doc.objects, p, tol, tool !== "move");
      setHoverId(h?.id ?? null);
      return;
    }
    const cur = useAnnotate.getState().doc!;
    if (d.kind === "pan") {
      const el = viewport.current!;
      el.scrollLeft = d.scrollX - (e.clientX - d.sx);
      el.scrollTop = d.scrollY - (e.clientY - d.sy);
      return;
    }
    if (d.kind === "crop") {
      const o = d.orig;
      let r: { x: number; y: number; w: number; h: number };
      if (d.handle === "move") r = { ...o, x: o.x + p.x - d.start.x, y: o.y + p.y - d.start.y };
      else if (d.handle === "new") r = norm({ x: d.start.x, y: d.start.y, w: p.x - d.start.x, h: p.y - d.start.y });
      else r = norm(resizeBox(o, d.handle, p, st.cropRatio));
      if (st.cropRatio && d.handle === "new") r.h = r.w / st.cropRatio;
      // snap edges to the image bounds and object edges
      const snapT = 8 / zoom;
      const xs = [0, cur.baseW, ...cur.objects.flatMap((ob) => { const b = bounds(ob); return [b.x, b.x + b.w]; })];
      const ys = [0, cur.baseH, ...cur.objects.flatMap((ob) => { const b = bounds(ob); return [b.y, b.y + b.h]; })];
      const sn = (v: number, arr: number[]) => arr.reduce((best, a) => (Math.abs(a - v) < snapT && Math.abs(a - v) < Math.abs(best - v) ? a : best), v);
      if (d.handle === "move") {
        const nx = sn(r.x, xs);
        const nx2 = sn(r.x + r.w, xs) - r.w;
        r.x = nx !== r.x ? nx : nx2;
        const ny = sn(r.y, ys);
        const ny2 = sn(r.y + r.h, ys) - r.h;
        r.y = ny !== r.y ? ny : ny2;
      } else {
        const x1 = sn(r.x, xs);
        const x2 = sn(r.x + r.w, xs);
        const y1 = sn(r.y, ys);
        const y2 = sn(r.y + r.h, ys);
        r = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
      }
      useAnnotate.setState({ crop: { x: Math.round(r.x), y: Math.round(r.y), w: Math.max(1, Math.round(r.w)), h: Math.max(1, Math.round(r.h)) } });
      return;
    }
    if (d.kind === "marquee") {
      d.cur = p;
      const m = norm({ x: d.start.x, y: d.start.y, w: p.x - d.start.x, h: p.y - d.start.y });
      setMarquee(m);
      const ids = cur.objects
        .filter((o) => {
          const b = bounds(o);
          return b.x < m.x + m.w && b.x + b.w > m.x && b.y < m.y + m.h && b.y + b.h > m.y;
        })
        .map((o) => o.id);
      st.select(ids);
      return;
    }
    if (d.kind === "move") {
      const dx = p.x - d.start.x;
      const dy = p.y - d.start.y;
      const moved = new Map(d.orig.map((o) => [o.id, translate(o, dx, dy)]));
      st.setDocLive({ ...cur, objects: cur.objects.map((o) => moved.get(o.id) ?? o) });
      return;
    }
    if (d.kind === "handle") {
      const o = d.orig;
      let n: Obj = o;
      if (o.type === "line" || o.type === "arrow") {
        if (d.handle === "p1") {
          const q = e.shiftKey ? snap45({ x: o.x2, y: o.y2 }, p) : p;
          n = { ...o, x1: q.x, y1: q.y };
        } else if (d.handle === "p2") {
          const q = e.shiftKey ? snap45({ x: o.x1, y: o.y1 }, p) : p;
          n = { ...o, x2: q.x, y2: q.y };
        } else {
          // drag the on-curve point: control = 2*mid - (p1+p2)/2
          n = { ...o, cx: 2 * p.x - (o.x1 + o.x2) / 2, cy: 2 * p.y - (o.y1 + o.y2) / 2 };
        }
      } else if (o.type === "text") {
        const b = bounds(o);
        if (d.handle.length === 2) {
          // corner: scale the text around the opposite corner
          const ax = d.handle.includes("w") ? b.x + b.w : b.x;
          const ay = d.handle.includes("n") ? b.y + b.h : b.y;
          const k = Math.max(0.1, (Math.abs(p.x - ax) / b.w + Math.abs(p.y - ay) / b.h) / 2);
          const fontSize = Math.max(6, Math.min(400, o.fontSize * k));
          const scaled = { ...o, fontSize, width: o.width ? o.width * (fontSize / o.fontSize) : 0 };
          const nb = bounds(scaled);
          n = { ...scaled, x: d.handle.includes("w") ? ax - nb.w : ax, y: d.handle.includes("n") ? ay - nb.h : ay };
        } else if (d.handle === "e") n = { ...o, width: Math.max(40, p.x - o.x) };
        else n = { ...o, x: Math.min(p.x, b.x + b.w - 40), width: Math.max(40, b.x + b.w - p.x) };
      } else if ("w" in o) {
        const ratio = e.shiftKey || o.type === "image" ? Math.abs(o.w / o.h) || 1 : null;
        const r = resizeBox({ x: o.x, y: o.y, w: o.w, h: o.h }, d.handle, p, o.type === "image" && !e.shiftKey ? ratio : e.shiftKey ? ratio : null);
        n = { ...o, ...r } as Obj;
      }
      st.setDocLive({ ...cur, objects: cur.objects.map((x) => (x.id === o.id ? n : x)) });
      return;
    }
    if (d.kind === "create") {
      const o = cur.objects.find((x) => x.id === d.id);
      if (!o) return;
      let n: Obj = o;
      if (o.type === "pen" || o.type === "highlighter") {
        let pts = [...o.points, p];
        if (e.shiftKey) pts = [o.points[0], o.type === "highlighter" ? { x: p.x, y: o.points[0].y } : snap45(o.points[0], p)];
        n = { ...o, points: pts };
      } else if (o.type === "line" || o.type === "arrow") {
        let a = d.start;
        let b = e.shiftKey ? snap45(d.start, p) : p;
        if (o.type === "arrow" && inverseArrow !== e.altKey) [a, b] = [b, a];
        n = { ...o, x1: a.x, y1: a.y, x2: b.x, y2: b.y, cx: undefined, cy: undefined };
      } else if ("w" in o) {
        let w = p.x - d.start.x;
        let h = p.y - d.start.y;
        if (e.shiftKey) {
          const s = Math.max(Math.abs(w), Math.abs(h));
          w = Math.sign(w || 1) * s;
          h = Math.sign(h || 1) * s;
        }
        if (e.altKey && o.type !== "pixelate") n = { ...o, x: d.start.x - w, y: d.start.y - h, w: w * 2, h: h * 2 } as Obj;
        else n = { ...o, x: d.start.x, y: d.start.y, w, h } as Obj;
      }
      st.setDocLive({ ...cur, objects: cur.objects.map((x) => (x.id === o.id ? n : x)) });
    }
  };

  const onPointerUp = (e: React.PointerEvent) => {
    // apply the final pointer position (the last move event may be stale)
    if (drag.current && drag.current.kind !== "pan" && drag.current.kind !== "marquee") onPointerMove(e);
    const d = drag.current;
    drag.current = null;
    setMarquee(null);
    if (!d) return;
    const s = useAnnotate.getState();
    const cur = s.doc!;
    if (d.kind === "create") {
      const o = cur.objects.find((x) => x.id === d.id);
      if (!o) return;
      let tooSmall = false;
      if ("w" in o && o.type !== "image") tooSmall = Math.abs(o.w) < 3 && Math.abs(o.h) < 3;
      if (o.type === "line" || o.type === "arrow") tooSmall = Math.hypot(o.x2 - o.x1, o.y2 - o.y1) < 4;
      if (tooSmall) {
        // a click with a shape tool: drop the empty shape and undo the history push
        useAnnotate.setState({ doc: s.past[s.past.length - 1] ?? cur, past: s.past.slice(0, -1) });
        return;
      }
      let fin: Obj = o;
      if ("w" in o) {
        const b = norm(o as any);
        fin = { ...o, ...b } as Obj;
      }
      if (o.type === "pen") fin = { ...o, points: smoothPoints(o.points, smooth) };
      st.setDocLive({ ...cur, objects: cur.objects.map((x) => (x.id === o.id ? fin : x)) });
      st.select([o.id]);
      return;
    }
    if (d.kind === "handle") {
      const o = cur.objects.find((x) => x.id === d.id);
      if (o && "w" in o) st.setDocLive({ ...cur, objects: cur.objects.map((x) => (x.id === o.id ? ({ ...o, ...norm(o as any) } as Obj) : x)) });
    }
  };

  // ---------- overlays (selection handles, text editor, crop) ----------
  const toScreen = (x: number, y: number) => ({ left: (x - doc.canvas.x + L.ox) * zoom, top: (y - doc.canvas.y + L.oy) * zoom });
  const selObj = selected.length === 1 ? doc.objects.find((o) => o.id === selected[0]) : null;
  const selBounds = selectionBounds(doc, selected);
  const editing = st.editingText ? (doc.objects.find((o) => o.id === st.editingText) as TextObj | undefined) : undefined;
  const cursor = space ? "grab" : tool === "move" ? "default" : tool === "text" ? "text" : "crosshair";
  const hoverObj = hoverId && !selected.includes(hoverId) ? doc.objects.find((o) => o.id === hoverId) : null;

  const pad = Math.max(48, Math.max(0, (vp.w - L.outW * zoom) / 2));
  const padY = Math.max(48, Math.max(0, (vp.h - L.outH * zoom) / 2));

  return (
    <div ref={viewport} className="flex-1 overflow-auto relative" style={{ background: "var(--win-bg-2)" }}>
      <div style={{ width: L.outW * zoom + pad * 2, height: L.outH * zoom + padY * 2, position: "relative" }}>
        <div
          className="absolute"
          style={{ left: pad, top: padY, width: L.outW * zoom, height: L.outH * zoom, cursor }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => setHoverId(null)}
          onDoubleClick={(e) => {
            if (tool === "crop" && crop) applyCrop();
            else {
              const p = toDoc(e);
              const h = topHit(doc.objects, p, tol, false);
              if (h?.type === "text") startText(p, h as TextObj);
            }
          }}
        >
          <div className="absolute inset-0 checker" style={{ boxShadow: "0 0 0 0.5px var(--border-strong), 0 6px 24px rgba(0,0,0,0.18)" }} />
          <canvas ref={canvasRef} className="absolute inset-0" style={{ width: L.outW * zoom, height: L.outH * zoom }} />

          {hoverObj && tool === "move" && <Outline b={bounds(hoverObj)} toScreen={toScreen} zoom={zoom} dashed={false} />}
          {selBounds && !editing && tool !== "crop" && (
            <>
              <Outline b={selBounds} toScreen={toScreen} zoom={zoom} dashed />
              {selObj &&
                handles(selObj).map((h) => {
                  const s = toScreen(h.x, h.y);
                  return (
                    <div
                      key={h.id}
                      data-handle={h.id}
                      className="absolute w-[11px] h-[11px] -ml-[5.5px] -mt-[5.5px] rounded-full bg-white"
                      style={{
                        ...s,
                        boxShadow: h.id === "ctrl" ? "0 0 0 2px var(--accent)" : "0 0 0 1px rgba(0,0,0,0.35), 0 1px 3px rgba(0,0,0,0.3)",
                        cursor: h.id === "p1" || h.id === "p2" || h.id === "ctrl" ? "move" : `${h.id}-resize`,
                      }}
                    />
                  );
                })}
            </>
          )}
          {marquee && (
            <div
              className="absolute border border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]"
              style={{ ...toScreen(marquee.x, marquee.y), width: marquee.w * zoom, height: marquee.h * zoom }}
            />
          )}
          {editing && <TextEditor o={editing} toScreen={toScreen} zoom={zoom} />}
          {tool === "crop" && crop && <CropOverlay crop={crop} toScreen={toScreen} zoom={zoom} L={L} doc={doc} />}
        </div>
      </div>
    </div>
  );

  function applyCrop() {
    const c = useAnnotate.getState().crop;
    if (c && c.w > 2 && c.h > 2) st.setCanvas(c);
    st.setTool("arrow");
  }
}

function Outline({ b, toScreen, zoom, dashed }: { b: { x: number; y: number; w: number; h: number }; toScreen: (x: number, y: number) => { left: number; top: number }; zoom: number; dashed: boolean }) {
  const s = toScreen(b.x, b.y);
  return (
    <div
      className="absolute pointer-events-none"
      style={{
        left: s.left - 3,
        top: s.top - 3,
        width: b.w * zoom + 6,
        height: b.h * zoom + 6,
        border: dashed ? "1px dashed var(--accent)" : "1px solid color-mix(in srgb, var(--accent) 60%, transparent)",
        borderRadius: 3,
      }}
    />
  );
}

function TextEditor({ o, toScreen, zoom }: { o: TextObj; toScreen: (x: number, y: number) => { left: number; top: number }; zoom: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const L = measureText(o);
  const s = toScreen(o.x, o.y);
  const boxed = o.style === 2 || o.style === 3 || o.style === 5;
  useEffect(() => {
    const el = ref.current!;
    el.innerText = o.text;
    el.focus();
    requestAnimationFrame(() => el.focus());
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    const sel = window.getSelection();
    sel?.removeAllRanges();
    sel?.addRange(range);
  }, [o.id]);
  const finish = () => {
    const st = useAnnotate.getState();
    const text = ref.current?.innerText.replace(/\n$/, "") ?? "";
    useAnnotate.setState({ editingText: null });
    if (!text.trim()) {
      const doc = st.doc!;
      st.setDocLive({ ...doc, objects: doc.objects.filter((x) => x.id !== o.id) });
      st.select([]);
    } else {
      st.update(o.id, { text } as Partial<TextObj>, true);
    }
  };
  const textColor = boxed ? (isLight(o.color) ? "#000" : "#fff") : o.color;
  return (
    <div
      data-texteditor
      ref={ref}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      className="absolute outline-none whitespace-pre-wrap"
      style={{
        left: s.left,
        top: s.top,
        minWidth: 20 * zoom,
        width: o.width ? o.width * zoom : undefined,
        font: textFont({ style: o.style, fontSize: o.fontSize * zoom }),
        lineHeight: `${L.lineHeight * zoom}px`,
        padding: `${L.padY * zoom}px ${L.padX * zoom}px`,
        color: textColor,
        background: boxed ? o.color : "transparent",
        borderRadius: boxed ? (o.style === 3 ? 999 : o.fontSize * 0.18 * zoom) : 2,
        textAlign: o.align,
        caretColor: textColor,
        boxShadow: boxed ? undefined : "0 0 0 1px color-mix(in srgb, var(--accent) 70%, transparent)",
        WebkitTextStroke: o.style === 1 || o.style === 6 ? `${Math.max(1, o.fontSize * 0.06 * zoom)}px ${isLight(o.color) ? "#000" : "#fff"}` : undefined,
        paintOrder: "stroke fill",
      }}
      onInput={(e) => {
        const st = useAnnotate.getState();
        const doc = st.doc!;
        st.setDocLive({ ...doc, objects: doc.objects.map((x) => (x.id === o.id ? { ...x, text: (e.target as HTMLElement).innerText } : x)) as any });
      }}
      onBlur={finish}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          (e.target as HTMLElement).blur();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
    />
  );
}

function CropOverlay({
  crop,
  toScreen,
  zoom,
  L,
  doc,
}: {
  crop: { x: number; y: number; w: number; h: number };
  toScreen: (x: number, y: number) => { left: number; top: number };
  zoom: number;
  L: { outW: number; outH: number };
  doc: { canvas: { x: number; y: number } };
}) {
  const s = toScreen(crop.x, crop.y);
  const w = crop.w * zoom;
  const h = crop.h * zoom;
  const hs: HandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const pos = (id: HandleId) => ({
    left: id.includes("w") ? -6 : id.includes("e") ? w - 6 : w / 2 - 6,
    top: id.includes("n") ? -6 : id.includes("s") ? h - 6 : h / 2 - 6,
  });
  void L;
  void doc;
  return (
    <>
      <svg className="absolute pointer-events-none overflow-visible" style={{ left: 0, top: 0, width: 1, height: 1 }}>
        <path d={`M-4000,-4000 H8000 V8000 H-4000 Z M${s.left},${s.top} h${w} v${h} h${-w} Z`} fillRule="evenodd" fill="rgba(0,0,0,0.5)" />
      </svg>
      <div className="absolute pointer-events-none" style={{ left: s.left, top: s.top, width: w, height: h, outline: "1px solid rgba(255,255,255,0.9)" }}>
        {/* rule of thirds */}
        <div className="absolute inset-0" style={{ backgroundImage: "linear-gradient(to right, transparent 33.2%, rgba(255,255,255,.35) 33.3%, transparent 33.4%, transparent 66.5%, rgba(255,255,255,.35) 66.6%, transparent 66.7%), linear-gradient(to bottom, transparent 33.2%, rgba(255,255,255,.35) 33.3%, transparent 33.4%, transparent 66.5%, rgba(255,255,255,.35) 66.6%, transparent 66.7%)" }} />
        <div className="absolute -bottom-7 right-0 hud rounded px-1.5 py-0.5 text-[11px] tabular-nums">
          {Math.round(crop.w)} × {Math.round(crop.h)}
        </div>
      </div>
      <div className="absolute" style={{ left: s.left, top: s.top, width: w, height: h, cursor: "move" }}>
        {hs.map((id) => (
          <div
            key={id}
            data-crophandle={id}
            className="absolute w-3 h-3 bg-white rounded-sm"
            style={{ ...pos(id), boxShadow: "0 0 0 1px rgba(0,0,0,0.4)", cursor: `${id}-resize` }}
          />
        ))}
      </div>
    </>
  );
}
