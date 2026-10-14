import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { ChevronUp, Copy, Download, Eye, Film, Pencil, Pin, Scissors, Share, X } from "lucide-react";
import clsx from "clsx";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { basename, fileUrl, formatBytes, formatDuration, invoke, listenHere, type CaptureItem } from "../../lib/ipc";
import { popupMenu } from "../../lib/menu";
import { useSettings } from "../../lib/settings";
import { useKeys, type KeyLike } from "../../lib/sessionKeys";

interface Layout {
  cardW: number;
  cardH: number;
  gap: number;
  topBar: number;
  sidePad: number;
  side: "left" | "right";
}
interface QaState {
  items: CaptureItem[];
  layout: Layout;
  autoClose: boolean;
  autoCloseInterval: number;
  askName: boolean;
  showInfo: boolean;
  canRestore: boolean;
  /** tucked away at the bottom edge: only a tab shows */
  tucked: boolean;
}

const TIPS = [
  "Press Space to preview · Double-click to annotate",
  "Drag & drop thumbnails into any app",
  "Right-click a thumbnail for more actions",
  "Swipe towards the edge to dismiss · Swipe down to hide them all",
  "Use the pin to keep it on screen",
  "Closed one by mistake? Restore Last Capture",
];

export default function QuickAccess() {
  const [st, setSt] = useState<QaState | null>(null);
  const [hoverStack, setHoverStack] = useState(false);
  // card under the cursor, from the native hover tracker (WebKit gives no
  // hover events to an inactive app's windows)
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);
  const focused = useRef<string | null>(null);
  const lastCount = useRef(0);
  const tipsShown = useSettings((s) => s.settings?.qaTipsShown ?? 0);
  const list = useRef<HTMLDivElement>(null);
  const [olderAbove, setOlderAbove] = useState(false);
  const swipeDown = useSwipeDown(list, () => invoke("qa_set_tucked", { tucked: true }));

  // one quick tip per new capture, for the first few captures
  useEffect(() => {
    const n = st?.items.length ?? 0;
    if (n > lastCount.current && tipsShown < TIPS.length) {
      setTip(TIPS[tipsShown]);
      useSettings.getState().set({ qaTipsShown: tipsShown + 1 });
      const t = window.setTimeout(() => setTip(null), 7000);
      lastCount.current = n;
      return () => window.clearTimeout(t);
    }
    lastCount.current = n;
  }, [st?.items.length]);

  useEffect(() => {
    invoke<QaState>("qa_state").then(setSt);
    const un = listenHere<QaState>("qa:update", setSt);
    const un2 = listenHere<[number, number] | null>("hover", (pos) => {
      if (!pos) {
        setHoverStack(false);
        setHoverId(null);
        return;
      }
      setHoverStack(true);
      const el = document.elementFromPoint(pos[0], pos[1]) as HTMLElement | null;
      const id = el?.closest<HTMLElement>("[data-card]")?.dataset.card ?? null;
      setHoverId(id);
      if (id) focused.current = id;
    });
    return () => {
      un.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  const act = useCallback(async (id: string, action: string, arg?: string) => {
    try {
      return await invoke("qa_action", { id, action, arg });
    } catch (e) {
      console.error(e);
    }
  }, []);

  // keyboard shortcuts on the focused (last hovered) card; Space and Esc
  // also arrive as session keys while the cursor is over a thumbnail
  useKeys((e: KeyLike) => {
    if (st?.tucked || (e.target as HTMLElement | null)?.tagName === "INPUT") return;
    const id = hoverId ?? focused.current ?? st?.items[st.items.length - 1]?.id;
    if (!id) return;
    const item = st?.items.find((i) => i.id === id);
    if (e.code === "Space") {
      e.preventDefault();
      if (!e.repeat) act(id, "quicklook");
    } else if (e.metaKey && e.key === "c") {
      act(id, "copy");
    } else if (e.metaKey && e.key === "s") {
      e.preventDefault();
      act(id, "save");
    } else if (e.key === "Escape" || e.key === "Backspace" || (e.metaKey && e.key === "w")) {
      e.preventDefault();
      act(id, "close");
    } else if (e.key === "Enter") {
      act(id, item?.kind === "screenshot" ? "annotate" : "editor");
    } else if (e.metaKey && e.key === "p") {
      e.preventDefault();
      if (item?.kind === "screenshot") act(id, "pin");
    }
  });

  // the newest card (at the bottom) stays in view when the stack scrolls
  const count = st?.items.length ?? 0;
  useLayoutEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [count, st?.tucked]);

  if (!st) return null;
  if (st.tucked) return <TuckedTab count={count} />;
  const { layout } = st;
  const multi = st.items.length > 1;

  return (
    <div
      className="w-full h-full flex flex-col"
      style={{ paddingLeft: layout.sidePad, paddingRight: layout.sidePad }}
      onMouseEnter={() => setHoverStack(true)}
      onMouseLeave={() => setHoverStack(false)}
    >
      <div className="shrink-0 flex items-end justify-center gap-2" style={{ height: layout.topBar, paddingBottom: 8, opacity: (multi && hoverStack) || tip ? 1 : 0, transition: "opacity .15s" }}>
        {tip && !(multi && hoverStack) && (
          <button onClick={() => setTip(null)} className="hud rounded-full px-3 h-7 text-[11.5px] font-medium max-w-full truncate" style={{ animation: "pop-in .2s ease-out" }} title="Click to dismiss">
            💡 {tip}
          </button>
        )}
        {multi && hoverStack && (
          <>
            <button onClick={() => invoke("qa_close_all")} className="hud rounded-full px-3 h-7 text-[12px] font-medium hover:bg-black/70">
              Close All
            </button>
            <button onClick={() => invoke("qa_save_all")} className="hud rounded-full px-3 h-7 text-[12px] font-medium hover:bg-black/70">
              Save All
            </button>
          </>
        )}
      </div>
      {/* scrolls when the stack is taller than the screen; fades out at the
          top while older cards are scrolled out of view */}
      <div
        ref={list}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar flex flex-col"
        onScroll={(e) => setOlderAbove(e.currentTarget.scrollTop > 1)}
        onWheel={swipeDown.onWheel}
        style={{
          maskImage: olderAbove ? "linear-gradient(to bottom, transparent, black 40px)" : undefined,
          transform: `translateY(${swipeDown.pull}px)`,
          opacity: 1 - Math.min(0.6, swipeDown.pull / 250),
          transition: swipeDown.pull ? "none" : "transform .2s ease, opacity .2s ease",
          animation: "qa-slide-up .25s ease-out",
        }}
      >
        <div className="mt-auto flex flex-col" style={{ gap: layout.gap, paddingBottom: layout.gap }}>
        {st.items.map((item, i) => (
          <Card
            key={item.id}
            item={item}
            layout={layout}
            st={st}
            isNewest={i === st.items.length - 1}
            hovered={hoverId === item.id}
            act={act}
            onFocus={() => (focused.current = item.id)}
          />
        ))}
        </div>
      </div>
    </div>
  );
}

/** Pull distance (px) at which a swipe down tucks the stack away. */
const TUCK_DISTANCE = 90;

/** Whether a wheel event comes from fingers moving down on the trackpad
 *  (deltaY's sign depends on the "Natural scrolling" setting). */
function fingersDown(e: React.WheelEvent) {
  const natural = (e.nativeEvent as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean }).webkitDirectionInvertedFromDevice ?? true;
  return natural ? e.deltaY < 0 : e.deltaY > 0;
}

/**
 * Two-finger swipe down on the stack tucks it away (like CleanShot). When
 * the stack scrolls, the swipe first scrolls it: it only counts once the
 * stack can't scroll further that way, from the start of a new gesture
 * (so momentum from browsing never hides it).
 */
function useSwipeDown(list: React.RefObject<HTMLDivElement | null>, onTuck: () => void) {
  const [pull, setPull] = useState(0);
  const g = useRef({ lastEvent: 0, armed: false, sum: 0, release: 0 });
  const onWheel = (e: React.WheelEvent) => {
    if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return; // sideways: a card's dismiss swipe
    const s = g.current;
    const now = performance.now();
    if (now - s.lastEvent > 300) {
      const el = list.current;
      const canScroll = !!el && (e.deltaY < 0 ? el.scrollTop > 0 : el.scrollTop + el.clientHeight < el.scrollHeight - 1);
      s.armed = !canScroll;
      s.sum = 0;
    }
    s.lastEvent = now;
    if (!s.armed || !fingersDown(e)) return;
    s.sum += Math.abs(e.deltaY);
    if (s.sum > TUCK_DISTANCE) {
      s.armed = false;
      setPull(0);
      onTuck();
      return;
    }
    setPull(s.sum);
    // fingers lifted before the distance: spring back
    window.clearTimeout(s.release);
    s.release = window.setTimeout(() => setPull(0), 160);
  };
  return { pull, onWheel };
}

/** What's left of a tucked stack: click or swipe up to bring it back. */
function TuckedTab({ count }: { count: number }) {
  const show = () => invoke("qa_set_tucked", { tucked: false });
  return (
    <div className="w-full h-full flex items-end justify-center">
      <button
        title="Show Quick Access"
        onClick={show}
        onWheel={(e) => {
          if (Math.abs(e.deltaY) > Math.abs(e.deltaX) && !fingersDown(e)) show();
        }}
        className="hud w-full h-[28px] rounded-t-[10px] flex items-center justify-center gap-1 text-[12px] font-semibold tabular-nums"
        style={{ animation: "qa-slide-up .2s ease-out" }}
      >
        <ChevronUp size={15} strokeWidth={2.5} />
        {count}
      </button>
    </div>
  );
}

function Card({
  item,
  layout,
  st,
  isNewest,
  hovered,
  act,
  onFocus,
}: {
  hovered: boolean;
  item: CaptureItem;
  layout: Layout;
  st: QaState;
  isNewest: boolean;
  act: (id: string, action: string, arg?: string) => Promise<any>;
  onFocus: () => void;
}) {
  const [mouseHover, setHover] = useState(false);
  const hover = mouseHover || hovered;
  const [swipe, setSwipe] = useState(0);
  const [leaving, setLeaving] = useState<null | number>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [renaming, setRenaming] = useState(st.askName && isNewest && item.kind === "screenshot" && Date.now() - item.created < 3000);
  const [name, setName] = useState(basename(item.path).replace(/\.[^.]+$/, ""));
  const dragStart = useRef<{ x: number; y: number } | null>(null);
  const swipeAcc = useRef(0);
  const swipeTimer = useRef<number | null>(null);
  const video = item.kind !== "screenshot";

  // auto-close (paused while hovered)
  useEffect(() => {
    if (!st.autoClose || hover || renaming) return;
    const t = window.setTimeout(() => dismiss("autoclose"), st.autoCloseInterval * 1000);
    return () => window.clearTimeout(t);
  }, [st.autoClose, st.autoCloseInterval, hover, renaming]);

  const dismiss = (action = "close") => {
    const dir = layout.side === "left" ? -1 : 1;
    setLeaving(dir);
    window.setTimeout(() => act(item.id, action), 180);
  };

  const showFlash = (text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 900);
  };

  const onWheel = (e: React.WheelEvent) => {
    // two-finger swipe towards the screen edge dismisses the card
    if (Math.abs(e.deltaX) < Math.abs(e.deltaY)) return;
    swipeAcc.current += -e.deltaX;
    setSwipe(swipeAcc.current);
    if (swipeTimer.current) window.clearTimeout(swipeTimer.current);
    swipeTimer.current = window.setTimeout(() => {
      const towardsEdge = layout.side === "left" ? swipeAcc.current < -60 : swipeAcc.current > 60;
      if (towardsEdge) dismiss();
      else setSwipe(0);
      swipeAcc.current = 0;
    }, 120);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button, input")) return;
    dragStart.current = { x: e.clientX, y: e.clientY };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const s = dragStart.current;
    if (!s) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > 5) {
      dragStart.current = null;
      invoke<string>("drag_icon", { path: item.thumb || item.path })
        .then((icon) =>
          startDrag({ item: [item.path], icon: icon || item.thumb || item.path, mode: "copy" }, (r) => {
            if (r.result === "Dropped") act(item.id, "dragged");
          }),
        )
        .catch((e) => invoke("js_log", { level: "error", msg: `drag failed: ${e}` }));
    }
  };

  const contextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    popupMenu([
      ...(video
        ? [{ label: "Open Video Editor", action: () => act(item.id, "editor") }, { label: "Convert to GIF", enabled: item.kind === "video", action: () => act(item.id, "gif") }]
        : [
            { label: "Open Annotate Tool", action: () => act(item.id, "annotate") },
            { label: "Pin to the Screen", action: () => act(item.id, "pin") },
            {
              label: "Transform",
              items: [
                { label: "Rotate Left", action: () => act(item.id, "rotateLeft") },
                { label: "Rotate Right", action: () => act(item.id, "rotateRight") },
                { label: "Flip Horizontal", action: () => act(item.id, "flipH") },
                { label: "Flip Vertical", action: () => act(item.id, "flipV") },
                "separator" as const,
                { label: "Scale Retina to 1x", enabled: item.scale > 1, action: () => act(item.id, "scale1x") },
              ],
            },
          ]),
      "separator" as const,
      { label: "Copy", accelerator: "Cmd+C", action: () => act(item.id, "copy") },
      { label: "Save", accelerator: "Cmd+S", action: () => act(item.id, "save") },
      { label: "Save As...", action: () => saveAs() },
      { label: "Rename...", action: () => setRenaming(true) },
      "separator" as const,
      { label: "Open", action: () => act(item.id, "open") },
      { label: "Show in Finder", action: () => act(item.id, "reveal") },
      { label: "Quick Look", accelerator: "Space", action: () => act(item.id, "quicklook") },
      { label: "Share...", action: () => act(item.id, "share", JSON.stringify([e.clientX, e.clientY])) },
      "separator" as const,
      { label: "Hide Overlays", action: () => invoke("qa_set_tucked", { tucked: true }) },
      { label: "Close", action: () => dismiss() },
      { label: "Close All", enabled: st.items.length > 1, action: () => invoke("qa_close_all") },
      { label: "Save All", enabled: st.items.length > 1, action: () => invoke("qa_save_all") },
      "separator" as const,
      { label: "Move to Trash", action: () => act(item.id, "delete") },
    ]);
  };

  const saveAs = async () => {
    const ext = item.path.split(".").pop() ?? "png";
    const dir = await invoke<string>("export_dir");
    const p = await saveDialog({ defaultPath: `${dir}/${basename(item.path)}`, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (p) act(item.id, "saveTo", p);
  };

  const commitRename = async () => {
    setRenaming(false);
    if (name.trim()) {
      const r = await act(item.id, "rename", name.trim());
      if (r === undefined) setName(basename(item.path).replace(/\.[^.]+$/, ""));
    }
  };

  const tx = leaving !== null ? leaving * (layout.cardW + 40) : swipe;
  const thumb = fileUrl(item.thumb || item.path);

  return (
    <div
      data-card={item.id}
      className="relative shrink-0 rounded-[12px] overflow-hidden"
      style={{
        width: layout.cardW,
        height: layout.cardH,
        transform: `translateX(${tx}px)`,
        opacity: leaving !== null ? 0 : 1 - Math.min(0.7, Math.abs(swipe) / 260),
        transition: swipeAcc.current !== 0 ? "none" : "transform .2s ease, opacity .2s ease",
        animation: `${layout.side === "left" ? "slide-in-left" : "slide-in-right"} .28s cubic-bezier(.2,.9,.3,1.2)`,
        boxShadow: "0 0 0 0.5px rgba(0,0,0,0.35), 0 10px 30px rgba(0,0,0,0.35), 0 2px 6px rgba(0,0,0,0.25)",
      }}
      onMouseEnter={() => {
        setHover(true);
        onFocus();
      }}
      onMouseLeave={() => setHover(false)}
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (dragStart.current = null)}
      onDoubleClick={() => act(item.id, video ? "editor" : "annotate")}
      onContextMenu={contextMenu}
    >
      <div className="absolute inset-0 bg-[#1c1c1e]" />
      <img src={thumb} className="absolute inset-0 w-full h-full object-cover scale-110 blur-xl opacity-60" draggable={false} />
      <img src={thumb} className="absolute inset-0 w-full h-full object-contain" draggable={false} />

      {video && (
        <div className="absolute left-2 bottom-2 hud rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold flex items-center gap-1">
          {item.kind === "gif" ? "GIF" : <Film size={11} />}
          {item.duration ? formatDuration(item.duration) : ""}
        </div>
      )}

      <div className={clsx("absolute inset-0 transition-opacity duration-150", hover && !renaming ? "opacity-100" : "opacity-0 pointer-events-none")}>
        <div className="absolute inset-0 bg-black/45" />
        <RoundBtn className="left-2 top-2" title="Close (Esc)" onClick={() => dismiss()}>
          <X size={13} strokeWidth={2.6} />
        </RoundBtn>
        <div className="absolute right-2 top-2 flex gap-1.5">
          <RoundBtn title="Preview (Space)" onClick={() => act(item.id, "quicklook")}>
            <Eye size={13} />
          </RoundBtn>
          {video ? (
            <RoundBtn title="Edit video (↩)" onClick={() => act(item.id, "editor")}>
              <Scissors size={13} />
            </RoundBtn>
          ) : (
            <>
              <RoundBtn title="Edit in Annotate (↩)" onClick={() => act(item.id, "annotate")}>
                <Pencil size={13} />
              </RoundBtn>
              <RoundBtn title="Pin to the screen (⌘P)" onClick={() => act(item.id, "pin")}>
                <Pin size={13} />
              </RoundBtn>
            </>
          )}
        </div>
        {/* full-card layout box: click-through so it doesn't cover the corner buttons */}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 pointer-events-none">
          <PillBtn
            onClick={async () => {
              await act(item.id, "copy");
              showFlash("Copied");
            }}
          >
            <Copy size={13} /> Copy
          </PillBtn>
          <PillBtn onClick={() => act(item.id, "save")} onContext={saveAs}>
            <Download size={13} /> Save
          </PillBtn>
        </div>
        <RoundBtn className="right-2 bottom-2" title="Share" onClick={(e) => act(item.id, "share", JSON.stringify([e.clientX, e.clientY]))}>
          <Share size={12} />
        </RoundBtn>
        {st.showInfo && !video && (
          <div className="absolute left-2 bottom-2 text-[10.5px] font-medium text-white/85 tabular-nums">
            {Math.round(item.width / (item.scale || 1))}×{Math.round(item.height / (item.scale || 1))} · {formatBytes(item.size)}
          </div>
        )}
        {st.showInfo && video && <div className="absolute left-2 bottom-8 text-[10.5px] font-medium text-white/85">{formatBytes(item.size)}</div>}
      </div>

      {renaming && (
        <div className="absolute inset-x-2 bottom-2 hud rounded-lg p-1.5" onPointerDown={(e) => e.stopPropagation()}>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onFocus={(e) => {
              invoke("make_key", { label: "quickaccess" });
              e.target.select();
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") commitRename();
              if (e.key === "Escape") setRenaming(false);
            }}
            onBlur={commitRename}
            className="w-full bg-white/10 rounded px-2 h-6 text-[12px] text-white outline-none focus:ring-1 focus:ring-[var(--accent)]"
            placeholder="File name"
          />
        </div>
      )}

      {flash && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/55 text-white text-[13px] font-semibold" style={{ animation: "fade-in .12s" }}>
          {flash}
        </div>
      )}
    </div>
  );
}

function RoundBtn({ children, className, title, onClick }: { children: React.ReactNode; className?: string; title: string; onClick: (e: React.MouseEvent) => void }) {
  return (
    <button
      title={title}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      className={clsx(
        "w-[26px] h-[26px] rounded-full flex items-center justify-center text-white bg-white/18 hover:bg-white/32 backdrop-blur-md shadow",
        className && "absolute",
        className,
      )}
    >
      {children}
    </button>
  );
}

function PillBtn({ children, onClick, onContext }: { children: React.ReactNode; onClick: () => void; onContext?: () => void }) {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      onContextMenu={(e) => {
        if (onContext) {
          e.preventDefault();
          e.stopPropagation();
          onContext();
        }
      }}
      className="pointer-events-auto h-[30px] w-[96px] rounded-full bg-white text-[#1d1d1f] text-[12.5px] font-semibold flex items-center justify-center gap-1.5 hover:bg-white/90 active:scale-[0.97] transition-transform shadow-md"
    >
      {children}
    </button>
  );
}
