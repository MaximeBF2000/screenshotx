import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke, listenHere, params, type OverlayPayload, type WinInfo } from "../../lib/ipc";
import { clampRect, normRect, resizeRect, roundRect, type Handle, type Rect } from "./geometry";
import { Magnifier } from "./Magnifier";
import { DimOutside } from "../../components/Dim";
import { useKeys, type KeyLike } from "../../lib/sessionKeys";
import { AioToolbar, RecordToolbar, ScrollToolbar } from "./Toolbars";

type Phase = "idle" | "drag" | "adjust" | "window";

const displayId = Number(params.get("display"));

const HINTS: Record<string, string> = {
  allInOne: "Drag to select an area · Space to select the whole screen · Enter for fullscreen",
  record: "Drag to record a part of the screen · Space for window · Enter for fullscreen",
  scrolling: "Drag to capture the scrolling part of the screen.",
  ocr: "Drag to select the text you want to copy.",
  selfTimer: "Drag to select an area for the self-timer · Enter for fullscreen",
  window: "Click a window to capture it · Hold ⌥ to capture without shadow",
};

const CAMERA_CURSOR = `url("data:image/svg+xml;utf8,${encodeURIComponent(
  "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32'><path d='M6 11a2 2 0 0 1 2-2h3l2-2.5h6L21 9h3a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z' fill='white' stroke='black' stroke-width='1.5' stroke-linejoin='round'/><circle cx='16' cy='16.5' r='4.2' fill='none' stroke='black' stroke-width='1.5'/></svg>",
)}") 16 16, pointer`;

/** Tell Rust this overlay rendered the session, so it can be made visible. */
function markReady(sessionId: number) {
  // (no rAF: hidden windows get no animation frames)
  window.setTimeout(() => invoke("overlay_ready", { displayId, sessionId }), 20);
}

export default function Overlay() {
  const [p, setP] = useState<OverlayPayload | null>(null);
  const [imgReady, setImgReady] = useState(false);
  const [mouse, setMouse] = useState<{ x: number; y: number } | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [sel, setSel] = useState<Rect | null>(null);
  const [mods, setMods] = useState({ shift: false, alt: false, cmd: false, space: false });
  const [ratio, setRatio] = useState<number | null>(null);
  const [hint, setHint] = useState(true);
  // window picked in record mode: record that window (follows it) unless the selection changes
  const [pickedWindow, setPickedWindow] = useState<number | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const drag = useRef<{ kind: "new" | "move" | Handle; sx: number; sy: number; orig: Rect | null; spaceBase?: { x: number; y: number } } | null>(null);
  const prevMode = useRef<Phase>("idle");
  // The overlay takes the mouse as soon as the capture starts (Rust
  // `show_shields`), before the session is loaded: a press in that gap
  // starts the selection once it is
  const earlyDown = useRef<{ x: number; y: number } | null>(null);

  const W = p?.display.width ?? window.innerWidth;
  const H = p?.display.height ?? window.innerHeight;
  // All-In-One switches to the recording setup bar before recording; Space in
  // Area mode switches to All-In-One with the whole screen selected
  const [modeOverride, setModeOverride] = useState<{ mode: "record"; kind: "video" | "gif" } | { mode: "allInOne" } | null>(null);
  const recordKind = modeOverride?.mode === "record" ? modeOverride.kind : undefined;
  // Area mode turned into All-In-One with Space (Esc then behaves like All-In-One)
  const aioFromSpace = useRef(false);
  const mode = modeOverride?.mode ?? p?.mode;

  const reset = useCallback(() => {
    setP(null);
    setImgReady(false);
    setSel(null);
    setPhase("idle");
    setModeOverride(null);
    aioFromSpace.current = false;
    setMouse(null);
    setRatio(null);
    drag.current = null;
  }, []);

  const load = useCallback(async () => {
    const payload = await invoke<OverlayPayload | null>("overlay_payload", { displayId });
    invoke("js_log", { level: "info", msg: `overlay load display=${displayId} payload=${payload ? payload.sessionId : "none"} url=${location.href}` });
    if (!payload) return;
    setImgReady(false);
    setModeOverride(null);
    aioFromSpace.current = false;
    setP(payload);
    setHint(true);
    setMods({ shift: false, alt: false, cmd: false, space: false });
    document.documentElement.style.setProperty("--accent", payload.accent);
    setMouse(payload.mouse ? { x: payload.mouse[0], y: payload.mouse[1] } : null);
    const initial = payload.preset ?? payload.remember;
    const early = earlyDown.current;
    earlyDown.current = null;
    if (payload.mode === "window") {
      setPhase("window");
      setSel(null);
    } else if (early) {
      drag.current = { kind: "new", sx: early.x, sy: early.y, orig: null };
      setSel({ x: early.x, y: early.y, w: 0, h: 0 });
      setPhase("drag");
      setHint(false);
    } else if (initial && (payload.mode === "allInOne" || payload.mode === "record" || payload.mode === "scrolling")) {
      setSel({ x: initial.x, y: initial.y, w: initial.w, h: initial.h });
      setPhase("adjust");
    } else {
      setSel(null);
      setPhase("idle");
    }
    // With Freeze screen, wait for the frozen image instead (`onLoad` below),
    // so the screen never visibly changes underneath the overlay
    if (!payload.freeze) markReady(payload.sessionId);
    // URL scheme: scrolling-capture?start=true with a preset area starts immediately
    if (payload.mode === "scrolling" && payload.preset && payload.settings.scrollingStart) {
      invoke("overlay_commit", {
        commit: { sessionId: payload.sessionId, displayId, kind: "scroll", rect: payload.preset, autoscroll: payload.settings.autoscroll },
      });
    }
  }, []);

  useEffect(() => {
    load();
    const un1 = listenHere("overlay:start", () => load());
    const un2 = listenHere("overlay:end", () => reset());
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [load, reset]);

  const commit = useCallback(
    (kind: string, extra: Record<string, any> = {}) => {
      if (!p) return;
      const rect = extra.rect ?? (sel ? roundRect(sel) : null);
      invoke("overlay_commit", { commit: { sessionId: p.sessionId, displayId, kind, rect, ...extra } });
      reset();
    },
    [p, sel, reset],
  );

  const cancel = useCallback(() => {
    invoke("overlay_cancel");
    reset();
  }, [reset]);

  const hoverWin: WinInfo | null = useMemo(() => {
    if (phase !== "window" || !mouse || !p) return null;
    return p.windows.find((w) => mouse.x >= w.x && mouse.x < w.x + w.width && mouse.y >= w.y && mouse.y < w.y + w.height) ?? null;
  }, [phase, mouse, p]);

  // ---------- keyboard ----------
  useKeys(
    (e: KeyLike) => {
      if (!p) return;
      setMods((m) => ({ ...m, shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey }));
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT") {
        if (e.key === "Escape") (target as HTMLInputElement).blur();
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        // All-In-One: the first Esc clears the selection (for this session
        // only: the remembered area is kept), the second one leaves
        if (p.mode === "allInOne" || aioFromSpace.current) {
          if (sel && phase !== "idle") {
            drag.current = null;
            setSel(null);
            setPickedWindow(null);
            setModeOverride(aioFromSpace.current ? { mode: "allInOne" } : null);
            setPhase("idle");
            return;
          }
          if (phase === "window") {
            setPhase("idle");
            return;
          }
        }
        cancel();
        return;
      }
      if (e.code === "Space") {
        e.preventDefault();
        if (e.repeat) return;
        if (phase === "drag") {
          setMods((m) => ({ ...m, space: true }));
          if (drag.current && mouse) drag.current.spaceBase = { x: mouse.x, y: mouse.y };
          return;
        }
        if (phase === "idle" && (mode === "area" || mode === "allInOne")) {
          // the whole screen as the selection, with the All-In-One toolbar
          setHint(false);
          setPickedWindow(null);
          setSel({ x: 0, y: 0, w: W, h: H });
          if (mode === "area") {
            aioFromSpace.current = true;
            setModeOverride({ mode: "allInOne" });
          }
          setPhase("adjust");
          return;
        }
        if (phase === "idle" || phase === "window") {
          if (mode === "scrolling" || mode === "ocr") return;
          setPhase(phase === "window" ? prevMode.current : "window");
          if (phase !== "window") prevMode.current = "idle";
          return;
        }
        if (phase === "adjust" && mode !== "scrolling") {
          prevMode.current = "adjust";
          setPhase("window");
        }
        return;
      }
      if (e.key === "Enter") {
        e.preventDefault();
        if (phase === "adjust" && sel) {
          if (mode === "allInOne") commit("area");
          else if (mode === "record") commit("record", { recordKind: p.recordKind, windowId: pickedWindow ?? undefined });
          else if (mode === "scrolling") commit("scroll");
        } else if (phase === "idle") {
          const full = { x: 0, y: 0, w: W, h: H };
          if (mode === "allInOne") commit("fullscreen", { rect: full });
          else if (mode === "record") commit("record", { rect: full, recordKind: p.recordKind });
          else if (mode === "selfTimer") commit("selftimer", { rect: full });
          else if (mode === "area") commit("fullscreen", { rect: full });
        }
        return;
      }
      if (phase === "adjust" && sel && e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        if (e.metaKey || e.altKey) {
          setSel(clampRect({ ...sel, w: Math.max(4, sel.w + dx), h: Math.max(4, sel.h + dy) }, W, H));
        } else {
          setSel(clampRect({ ...sel, x: sel.x + dx, y: sel.y + dy }, W, H));
        }
      }
    },
    (e: KeyLike) => {
      setMods((m) => ({ ...m, shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey, space: e.code === "Space" ? false : m.space }));
    },
  );

  // ---------- pointer ----------
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (!p) {
      earlyDown.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if ((e.target as HTMLElement).closest("[data-toolbar]")) return;
    setHint(false);
    const x = e.clientX;
    const y = e.clientY;
    if (phase === "window") {
      if (!hoverWin) return;
      const winRect = clampRect({ x: hoverWin.x, y: hoverWin.y, w: hoverWin.width, h: hoverWin.height }, W, H);
      if (mode === "window" || mode === "area" || mode === "allInOne" || mode === "selfTimer") {
        if (mode === "selfTimer") commit("selftimer", { rect: winRect });
        else commit("window", { windowId: hoverWin.id, noShadow: e.altKey });
      } else {
        setSel(winRect);
        setPickedWindow(mode === "record" ? hoverWin.id : null);
        setPhase("adjust");
      }
      return;
    }
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    const handle = (e.target as HTMLElement).dataset.handle as Handle | undefined;
    if (phase === "adjust" && sel) {
      if (handle) {
        drag.current = { kind: handle, sx: x, sy: y, orig: sel };
        return;
      }
      if (x >= sel.x && x <= sel.x + sel.w && y >= sel.y && y <= sel.y + sel.h) {
        drag.current = { kind: "move", sx: x, sy: y, orig: sel };
        return;
      }
    }
    drag.current = { kind: "new", sx: x, sy: y, orig: null };
    setPickedWindow(null);
    setSel({ x, y, w: 0, h: 0 });
    setPhase("drag");
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const x = Math.max(0, Math.min(W, e.clientX));
    const y = Math.max(0, Math.min(H, e.clientY));
    setMouse({ x, y });
    setMods((m) => (m.shift !== e.shiftKey || m.alt !== e.altKey || m.cmd !== e.metaKey ? { ...m, shift: e.shiftKey, alt: e.altKey, cmd: e.metaKey } : m));
    const d = drag.current;
    if (!d) return;
    if (d.kind === "new") {
      if (mods.space && d.spaceBase && sel) {
        // hold Space to move the selection while drawing
        const dx = x - d.spaceBase.x;
        const dy = y - d.spaceBase.y;
        d.sx += dx;
        d.sy += dy;
        d.spaceBase = { x, y };
        setSel(clampRect({ ...sel, x: sel.x + dx, y: sel.y + dy }, W, H));
        return;
      }
      setSel(newRect(d, x, y, e.shiftKey, e.altKey));
    } else if (d.kind === "move" && d.orig) {
      setPickedWindow(null);
      setSel(clampRect({ ...d.orig, x: d.orig.x + x - d.sx, y: d.orig.y + y - d.sy }, W, H));
    } else if (d.orig) {
      setPickedWindow(null);
      setSel(clampRect(resizeRect(d.orig, d.kind as Handle, x, y, e.shiftKey ? d.orig.w / d.orig.h : ratio), W, H));
    }
  };

  /** Selection for a new drag from the drag origin to (x, y). */
  const newRect = (d: { sx: number; sy: number }, x: number, y: number, shift: boolean, alt: boolean): Rect => {
    let x2 = x;
    let y2 = y;
    const lockRatio = shift ? 1 : ratio;
    if (lockRatio) {
      const dw = x - d.sx;
      const dh = y - d.sy;
      const w = Math.max(Math.abs(dw), Math.abs(dh) * lockRatio);
      const h = w / lockRatio;
      x2 = d.sx + Math.sign(dw || 1) * w;
      y2 = d.sy + Math.sign(dh || 1) * h;
    }
    if (alt) {
      // resize from the center
      const dw = x2 - d.sx;
      const dh = y2 - d.sy;
      return clampRect(normRect(d.sx - dw, d.sy - dh, d.sx + dw, d.sy + dh), W, H);
    }
    return normRect(d.sx, d.sy, Math.max(0, Math.min(W, x2)), Math.max(0, Math.min(H, y2)));
  };

  const onPointerUp = (e: React.PointerEvent) => {
    if (!p) {
      // released before the session loaded: just a click
      earlyDown.current = null;
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || !p) return;
    if (d.kind !== "new") return;
    // use the release position: the last move may not be rendered yet
    const r = mods.space ? sel : newRect(d, Math.max(0, Math.min(W, e.clientX)), Math.max(0, Math.min(H, e.clientY)), e.shiftKey, e.altKey);
    if (r) setSel(r);
    if (!r || r.w < 4 || r.h < 4) {
      // a click without dragging just resets the selection
      setSel(null);
      setPhase("idle");
      return;
    }
    if (mode === "area") commit("area", { rect: roundRect(r) });
    else if (mode === "ocr") commit("ocr", { rect: roundRect(r) });
    else if (mode === "selfTimer") commit("selftimer", { rect: roundRect(r) });
    else setPhase("adjust");
  };

  if (!p) return <div className="fixed inset-0" style={{ cursor: "crosshair" }} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} />;

  const showCross =
    (phase === "idle" || phase === "drag") &&
    mouse &&
    (p.crosshair === "always" || (p.crosshair === "whenCommandPressed" && mods.cmd));
  const dimAll = phase === "idle" && mode !== "area" && mode !== "ocr" && mode !== "selfTimer";
  const cursor = phase === "window" ? CAMERA_CURSOR : phase === "adjust" ? "default" : "crosshair";

  return (
    <div
      className="fixed inset-0 overflow-hidden select-none"
      style={{ cursor }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerEnter={() => invoke("overlay_focus", { displayId })}
      onPointerLeave={() => setMouse(null)}
      onContextMenu={(e) => {
        // right-click cancels the capture
        e.preventDefault();
        if (!(e.target as HTMLElement).closest("[data-toolbar]")) cancel();
      }}
      onWheel={(e) => {
        // ⌘-scroll resizes the selection proportionally in adjust mode
        if (phase === "adjust" && sel && e.metaKey) {
          const k = e.deltaY > 0 ? 0.98 : 1.02;
          const nw = sel.w * k;
          const nh = sel.h * k;
          setSel(clampRect({ x: sel.x - (nw - sel.w) / 2, y: sel.y - (nh - sel.h) / 2, w: nw, h: nh }, W, H));
        }
      }}
    >
      <img
        ref={imgRef}
        src={p.imageUrl}
        onLoad={() => {
          setImgReady(true);
          if (p.freeze) markReady(p.sessionId);
        }}
        onError={() => p.freeze && markReady(p.sessionId)}
        draggable={false}
        className="absolute inset-0 w-full h-full pointer-events-none"
        style={{ opacity: p.freeze && imgReady ? 1 : 0, imageRendering: "auto" }}
      />

      {dimAll && <div className="absolute inset-0 bg-black/20 pointer-events-none" />}

      {phase === "window" && hoverWin && (
        <div
          className="absolute pointer-events-none rounded-[10px] transition-all duration-75"
          style={{
            left: hoverWin.x,
            top: hoverWin.y,
            width: hoverWin.width,
            height: hoverWin.height,
            background: "color-mix(in srgb, var(--accent) 28%, transparent)",
            boxShadow: "inset 0 0 0 2px color-mix(in srgb, var(--accent) 70%, transparent)",
          }}
        >
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hud rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap max-w-[90%] truncate">
            {hoverWin.owner}
            {hoverWin.title ? <span className="opacity-60"> — {hoverWin.title}</span> : null}
          </div>
        </div>
      )}
      {phase === "window" && !hoverWin && <div className="absolute inset-0 bg-black/10 pointer-events-none" />}

      {sel && phase !== "window" && (sel.w > 0 || sel.h > 0) && (
        <Selection sel={sel} phase={phase} W={W} H={H} />
      )}

      {showCross && mouse && (
        <>
          <div className="absolute left-0 right-0 pointer-events-none" style={{ top: mouse.y, height: 1, background: "rgba(255,255,255,0.75)", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.45)" }} />
          <div className="absolute top-0 bottom-0 pointer-events-none" style={{ left: mouse.x, width: 1, background: "rgba(255,255,255,0.75)", boxShadow: "0 0 0 0.5px rgba(0,0,0,0.45)" }} />
        </>
      )}

      {p.magnifier && mouse && imgReady && (phase === "idle" || phase === "drag") && (
        <Magnifier img={imgRef.current} mouse={mouse} W={W} H={H} scale={p.display.scale} sel={phase === "drag" ? sel : null} />
      )}

      {hint && phase !== "adjust" && phase !== "drag" && (HINTS[phase === "window" ? "window" : mode ?? ""] ?? null) && (
        <div className="absolute left-1/2 top-[18%] -translate-x-1/2 hud rounded-xl px-4 py-2.5 text-[13px] pointer-events-none" style={{ animation: "fade-in .25s ease" }}>
          {HINTS[phase === "window" ? "window" : mode ?? ""]}
        </div>
      )}

      {phase === "adjust" && sel && mode === "allInOne" && (
        <AioToolbar
          sel={sel}
          W={W}
          H={H}
          ratio={ratio}
          setRatio={setRatio}
          setSel={(r) => setSel(clampRect(r, W, H))}
          commit={commit}
          cancel={cancel}
          toWindow={() => {
            prevMode.current = "adjust";
            setPhase("window");
          }}
          toRecord={(kind) => setModeOverride({ mode: "record", kind })}
        />
      )}
      {phase === "adjust" && sel && mode === "record" && (
        <RecordToolbar key={recordKind ?? "rec"} p={p} initialKind={recordKind ?? p.recordKind} pickedWindow={pickedWindow} sel={sel} W={W} H={H} ratio={ratio} setRatio={setRatio} setSel={(r) => setSel(clampRect(r, W, H))} commit={commit} cancel={cancel} />
      )}
      {phase === "adjust" && sel && mode === "scrolling" && <ScrollToolbar p={p} sel={sel} W={W} H={H} commit={commit} cancel={cancel} />}
    </div>
  );
}

function Selection({ sel, phase, W, H }: { sel: Rect; phase: Phase; W: number; H: number }) {
  const r = roundRect(sel);
  const label = `${r.w} × ${r.h}`;
  const below = r.y + r.h + 30 < H;
  const handles: Handle[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  const pos: Record<Handle, React.CSSProperties> = {
    nw: { left: -5, top: -5, cursor: "nwse-resize" },
    n: { left: "calc(50% - 5px)", top: -5, cursor: "ns-resize" },
    ne: { right: -5, top: -5, cursor: "nesw-resize" },
    e: { right: -5, top: "calc(50% - 5px)", cursor: "ew-resize" },
    se: { right: -5, bottom: -5, cursor: "nwse-resize" },
    s: { left: "calc(50% - 5px)", bottom: -5, cursor: "ns-resize" },
    sw: { left: -5, bottom: -5, cursor: "nesw-resize" },
    w: { left: -5, top: "calc(50% - 5px)", cursor: "ew-resize" },
  };
  return (
    <>
      <DimOutside x={sel.x} y={sel.y} w={sel.w} h={sel.h} opacity={0.38} />
      <div
        className="absolute pointer-events-none"
        style={{
          left: sel.x,
          top: sel.y,
          width: sel.w,
          height: sel.h,
          outline: "1px solid rgba(255,255,255,0.9)",
        }}
      />
      {phase === "adjust" && (
        <div className="absolute" style={{ left: sel.x, top: sel.y, width: sel.w, height: sel.h, cursor: "move" }}>
          <svg className="absolute inset-0 w-full h-full pointer-events-none overflow-visible">
            <rect x="0" y="0" width="100%" height="100%" fill="none" stroke="rgba(0,0,0,0.6)" strokeWidth="1" strokeDasharray="4 4" style={{ animation: "marching 0.6s linear infinite" }} />
          </svg>
          {handles.map((h) => (
            <div
              key={h}
              data-handle={h}
              className="absolute w-[10px] h-[10px] rounded-full bg-white"
              style={{ ...pos[h], boxShadow: "0 0 0 0.5px rgba(0,0,0,0.4), 0 1px 3px rgba(0,0,0,0.4)" }}
            />
          ))}
        </div>
      )}
      {r.w > 0 && (
        <div
          className="absolute hud rounded-md px-2 py-[3px] text-[11px] font-medium tabular-nums pointer-events-none whitespace-nowrap"
          style={{
            left: Math.min(Math.max(0, r.x + r.w - 2), W - 90),
            top: below ? r.y + r.h + 8 : Math.max(0, r.y - 26),
            transform: "translateX(-100%)",
            display: phase === "adjust" ? "none" : undefined,
          }}
        >
          {label}
        </div>
      )}
    </>
  );
}
