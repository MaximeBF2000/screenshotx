import { useCallback, useEffect, useRef, useState } from "react";
import clsx from "clsx";
import {
  ArrowUpRight,
  Circle,
  Crop,
  Ellipsis,
  Frame,
  GripVertical,
  Hash,
  Highlighter,
  ImagePlus,
  Minus,
  MousePointer2,
  Pencil,
  Pin,
  Redo2,
  Share,
  Square,
  SquareDashed,
  Type,
  Undo2,
  Grid2x2,
  Copy,
  Download,
} from "lucide-react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { basename, invoke, isTauri, listenHere, params, readFileBytes, ready } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { popupMenu } from "../../lib/menu";
import { AnnotateCanvas } from "./Canvas";
import { OptionsBar } from "./Options";
import { BackgroundPanel, ensureBackgroundImage } from "./BackgroundPanel";
import { ResizeDialog } from "./ResizeDialog";
import { useAnnotate } from "./store";
import { imgSize, loadBitmap, loadBytes, loadDataUrl } from "./images";
import * as actions from "./actions";
import { DEFAULT_BACKGROUND, DEFAULT_TOOL_SETTINGS, TOOL_KEYS, uid, type Doc, type ImageObj, type Tool } from "./types";
import type { ImgSrc } from "./render";

const TOOLS: { id: Tool; label: string; key: string; icon: React.ReactNode }[] = [
  { id: "move", label: "Select & Move", key: "V", icon: <MousePointer2 size={17} /> },
  { id: "crop", label: "Crop & Resize", key: "C", icon: <Crop size={17} /> },
  { id: "rect", label: "Rectangle", key: "R", icon: <Square size={17} /> },
  { id: "ellipse", label: "Ellipse", key: "O", icon: <Circle size={17} /> },
  { id: "line", label: "Line", key: "L", icon: <Minus size={17} className="-rotate-45" /> },
  { id: "arrow", label: "Arrow", key: "A", icon: <ArrowUpRight size={18} /> },
  { id: "text", label: "Text", key: "T", icon: <Type size={17} /> },
  { id: "pixelate", label: "Pixelate & Blur", key: "P", icon: <Grid2x2 size={17} /> },
  { id: "spotlight", label: "Spotlight", key: "S", icon: <SquareDashed size={17} /> },
  { id: "counter", label: "Counter", key: "N", icon: <Hash size={17} /> },
  { id: "pen", label: "Draw", key: "D", icon: <Pencil size={17} /> },
  { id: "highlighter", label: "Highlighter", key: "H", icon: <Highlighter size={17} /> },
];

async function buildDoc(path: string): Promise<{ doc: Doc; images: Map<string, ImgSrc>; project: boolean }> {
  const images = new Map<string, ImgSrc>();
  if (path.endsWith(".screenshotx")) {
    const json = JSON.parse(new TextDecoder().decode(await readFileBytes(path)));
    for (const [k, url] of Object.entries<string>(json.images ?? {})) images.set(k, await loadDataUrl(url));
    return { doc: json.doc, images, project: true };
  }
  if (!path) {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 800;
    images.set("base", c);
    return {
      doc: { base: "base", baseW: 1200, baseH: 800, scale: 1, canvas: { x: 0, y: 0, w: 1200, h: 800 }, objects: [], background: { ...DEFAULT_BACKGROUND } },
      images,
      project: false,
    };
  }
  const bmp = await loadBitmap(path);
  const { w, h } = imgSize(bmp);
  let scale = 1;
  try {
    const info = await invoke<[number, number, number]>("image_info", { path });
    if (info) scale = info[2] || 1;
  } catch {
    /* not a PNG with DPI info */
  }
  images.set("base", bmp);
  const bw = w / scale;
  const bh = h / scale;
  return {
    doc: { base: "base", baseW: bw, baseH: bh, scale, canvas: { x: 0, y: 0, w: bw, h: bh }, objects: [], background: { ...DEFAULT_BACKGROUND } },
    images,
    project: false,
  };
}

export default function Annotate() {
  const st = useAnnotate();
  const settings = useSettings((s) => s.settings);
  const [loaded, setLoaded] = useState(false);
  const [resizeOpen, setResizeOpen] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [title, setTitle] = useState("Annotate");
  const restored = useRef(false);

  const showFlash = useCallback((t: string) => {
    setFlash(t);
    window.setTimeout(() => setFlash(null), 1100);
  }, []);

  // ---------- load ----------
  useEffect(() => {
    const path = params.get("path") ?? "";
    actions.source.path = path;
    actions.source.captureId = params.get("captureId") ?? "";
    actions.source.project = path.endsWith(".screenshotx");
    actions.source.external = !!path && !path.includes("/com.screenshotx.app/");
    setTitle(path ? basename(path) : "Untitled");
    buildDoc(path)
      .then(({ doc, images }) => {
        useAnnotate.getState().init(doc, images);
        setLoaded(true);
        ready();
      })
      .catch((e) => {
        invoke("js_log", { level: "error", msg: `annotate load failed: ${e}` });
        ready();
      });
  }, []);

  // restore last tool settings once both settings and doc are ready
  useEffect(() => {
    if (!loaded || !settings || restored.current) return;
    restored.current = true;
    const last = settings.annotateLast ?? {};
    useAnnotate.setState({
      ts: { ...DEFAULT_TOOL_SETTINGS, ...(last.ts ?? {}) },
      tool: last.tool === "filledRect" ? "rect" : last.tool && last.tool !== "crop" ? last.tool : "arrow",
    });
    const presets = settings.backgroundPresets ?? [];
    if (settings.annotateRememberBackgroundTool && last.bgOpen) {
      const p = presets.find((x: any) => x.id === last.bgPreset);
      const d = useAnnotate.getState().doc!;
      const bg = p ? { ...DEFAULT_BACKGROUND, ...p, enabled: true } : { ...d.background, ...(last.bg ?? {}), enabled: true };
      delete (bg as any).id;
      delete (bg as any).name;
      useAnnotate.setState({ doc: { ...d, background: bg }, bgPanel: true });
      ensureBackgroundImage(bg);
    }
  }, [loaded, settings]);

  // persist tool settings (debounced)
  useEffect(() => {
    if (!restored.current) return;
    const t = window.setTimeout(() => {
      const s = useSettings.getState().settings;
      const { enabled: _e, ...bg } = st.doc?.background ?? DEFAULT_BACKGROUND;
      void _e;
      useSettings.getState().set({ annotateLast: { ...(s?.annotateLast ?? {}), ts: st.ts, tool: st.tool === "crop" || st.tool === "background" ? "arrow" : st.tool, bgOpen: st.bgPanel, bg } });
    }, 600);
    return () => window.clearTimeout(t);
  }, [st.ts, st.tool, st.bgPanel, st.doc?.background]);

  // window title shows unsaved state
  useEffect(() => {
    if (!isTauri) return;
    getCurrentWebviewWindow().setTitle(`${st.dirty ? "• " : ""}${title}`);
  }, [title, st.dirty]);

  // ---------- add images ----------
  const addImageObj = useCallback(async (img: ImgSrc, key = "img-" + uid(), scale = 2) => {
    const s = useAnnotate.getState();
    const d = s.doc!;
    s.addImage(key, img);
    const { w, h } = imgSize(img);
    let ow = w / scale;
    let oh = h / scale;
    const max = Math.max(d.canvas.w, d.canvas.h) * 0.6;
    if (Math.max(ow, oh) > max) {
      const r = max / Math.max(ow, oh);
      ow *= r;
      oh *= r;
    }
    const n = d.objects.filter((o) => o.type === "image").length;
    const o: ImageObj = {
      id: uid(),
      type: "image",
      x: d.canvas.x + (d.canvas.w - ow) / 2 + n * 18,
      y: d.canvas.y + (d.canvas.h - oh) / 2 + n * 18,
      w: ow,
      h: oh,
      src: key,
      border: false,
      color: s.ts.color,
      size: 2,
      shadow: true,
    };
    s.add(o);
    s.setTool("move");
    s.select([o.id]);
  }, []);

  useEffect(() => {
    const un = listenHere<string>("annotate:add-image", async (path) => {
      const info = await invoke<[number, number, number]>("image_info", { path }).catch(() => null);
      addImageObj(await loadBitmap(path), undefined, info?.[2] ?? 2);
    });
    let unDrop: (() => void) | undefined;
    if (isTauri) {
      getCurrentWebviewWindow()
        .onDragDropEvent(async (e) => {
          if (e.payload.type !== "drop") return;
          for (const p of e.payload.paths) {
            if (!/\.(png|jpe?g|heic|webp|gif|tiff?)$/i.test(p)) continue;
            const info = await invoke<[number, number, number]>("image_info", { path: p }).catch(() => null);
            await addImageObj(await loadBitmap(p), undefined, info?.[2] ?? 1);
          }
        })
        .then((f) => (unDrop = f));
      getCurrentWebviewWindow().onCloseRequested(async (e) => {
        e.preventDefault();
        if (await actions.confirmClose()) invoke("close_window", { label: getCurrentWebviewWindow().label });
      });
    }
    return () => {
      un.then((f) => f());
      unDrop?.();
    };
  }, [addImageObj]);

  const pasteFromClipboard = useCallback(async () => {
    const s = useAnnotate.getState();
    if (s.clipboard.length) {
      s.pasteObjects();
      return;
    }
    try {
      const bytes = await invoke<ArrayBuffer>("clipboard_image_png");
      if (bytes) addImageObj(await loadBytes(bytes), undefined, 1);
    } catch {
      showFlash("No image on the clipboard");
    }
  }, [addImageObj, showFlash]);

  const addImageMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(
      [
        { label: "Add New Screenshot", action: () => invoke("annotate_capture_into") },
        {
          label: "Add Screenshot From File...",
          action: async () => {
            const { open } = await import("@tauri-apps/plugin-dialog");
            const p = await open({ multiple: true, filters: [{ name: "Images", extensions: ["png", "jpg", "jpeg", "heic", "webp", "gif", "tiff"] }] });
            for (const path of Array.isArray(p) ? p : p ? [p] : []) {
              const info = await invoke<[number, number, number]>("image_info", { path }).catch(() => null);
              await addImageObj(await loadBitmap(path), undefined, info?.[2] ?? 1);
            }
          },
        },
        { label: "Paste From Clipboard", accelerator: "Cmd+V", action: pasteFromClipboard },
      ],
      { x: b.left, y: b.bottom + 4 },
    );
  };

  const moreMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const s = useSettings.getState().settings;
    popupMenu(
      [
        { label: "Rotate Left", action: () => st.transform("rotateL") },
        { label: "Rotate Right", action: () => st.transform("rotateR") },
        { label: "Flip Horizontal", action: () => st.transform("flipH") },
        { label: "Flip Vertical", action: () => st.transform("flipV") },
        "separator",
        { label: "Resize Image...", action: () => setResizeOpen(true) },
        { label: "Flatten Annotations", enabled: !!st.doc?.objects.length, action: () => st.flatten() },
        { label: "Revert to Original", action: () => st.revert() },
        "separator",
        {
          label: "Always on Top",
          checked: !!s?.annotateAlwaysOnTop,
          action: () => {
            const v = !s?.annotateAlwaysOnTop;
            useSettings.getState().set({ annotateAlwaysOnTop: v });
            getCurrentWebviewWindow().setAlwaysOnTop(v);
          },
        },
        "separator",
        { label: "Save As...", accelerator: "Shift+Cmd+S", action: () => actions.saveAs() },
        {
          label: "Save as Project...",
          action: async () => {
            const { save: saveDialog } = await import("@tauri-apps/plugin-dialog");
            const dir = await invoke<string>("export_dir");
            const p = await saveDialog({ defaultPath: `${dir}/${title.replace(/\.[^.]+$/, "")}.screenshotx`, filters: [{ name: "Screenshot X Project", extensions: ["screenshotx"] }] });
            if (p) {
              await actions.saveProject(p);
              showFlash("Project saved");
            }
          },
        },
        { label: "Add to Quick Access Overlay", action: () => actions.toQuickAccess() },
        { label: "Print...", accelerator: "Cmd+P", action: () => actions.print() },
      ],
      { x: b.left, y: b.bottom + 4 },
    );
  };

  const zoomMenu = (e: React.MouseEvent) => {
    const b = (e.currentTarget as HTMLElement).getBoundingClientRect();
    popupMenu(
      [
        { label: "Zoom to Fit", accelerator: "Cmd+0", action: () => st.setZoom(st.zoom, true) },
        { label: "Actual Size", accelerator: "Cmd+1", action: () => st.setZoom(1) },
        "separator",
        ...[0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4].map((z) => ({ label: `${z * 100}%`, checked: Math.abs(st.zoom - z) < 0.001, action: () => st.setZoom(z) })),
      ],
      { x: b.left, y: b.bottom + 4 },
    );
  };

  // ---------- keyboard ----------
  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, select, [contenteditable=true]")) return;
      const s = useAnnotate.getState();
      const k = e.key.toLowerCase();
      const meta = e.metaKey || e.ctrlKey;
      if (meta) {
        if (k === "z" && !e.shiftKey) (e.preventDefault(), s.undo());
        else if ((k === "z" && e.shiftKey) || k === "y") (e.preventDefault(), s.redo());
        else if (k === "c") {
          e.preventDefault();
          if (s.selected.length) {
            await actions.copySelectedObject();
            showFlash("Object copied");
          } else {
            await actions.copy();
            showFlash("Copied");
          }
        } else if (k === "x" && s.selected.length) {
          e.preventDefault();
          s.copySelection();
          s.removeSelected();
        } else if (k === "v") (e.preventDefault(), pasteFromClipboard());
        else if (k === "d") (e.preventDefault(), s.duplicateSelected());
        else if (k === "a") (e.preventDefault(), s.setTool("move"), s.select(s.doc!.objects.map((o) => o.id)));
        else if (k === "s" && e.shiftKey) (e.preventDefault(), actions.saveAs());
        else if (k === "s") (e.preventDefault(), actions.save({ close: !e.altKey }));
        else if (k === "p" && e.shiftKey) (e.preventDefault(), actions.pin());
        else if (k === "p") (e.preventDefault(), actions.print());
        else if (k === "w") (e.preventDefault(), getCurrentWebviewWindow().close());
        else if (k === "=" || k === "+") (e.preventDefault(), s.setZoom(s.zoom * 1.25));
        else if (k === "-") (e.preventDefault(), s.setZoom(s.zoom / 1.25));
        else if (k === "0") (e.preventDefault(), s.setZoom(s.zoom, true));
        else if (k === "1") (e.preventDefault(), s.setZoom(1));
        else if (e.altKey && e.key === "ArrowUp") (e.preventDefault(), s.arrange("front"));
        else if (e.altKey && e.key === "ArrowDown") (e.preventDefault(), s.arrange("back"));
        else if (e.key === "ArrowUp") (e.preventDefault(), s.arrange("forward"));
        else if (e.key === "ArrowDown") (e.preventDefault(), s.arrange("backward"));
        return;
      }
      if (e.key === "Escape") {
        if (s.tool === "crop") s.setTool("arrow");
        else if (s.selected.length) s.select([]);
        return;
      }
      if (e.key === "Enter" && s.tool === "crop") {
        const c = s.crop;
        if (c && c.w > 2 && c.h > 2) s.setCanvas(c);
        s.setTool("arrow");
        return;
      }
      if ((e.key === "Backspace" || e.key === "Delete") && s.selected.length) {
        e.preventDefault();
        s.removeSelected();
        return;
      }
      if (e.key.startsWith("Arrow") && s.selected.length) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        s.nudge(e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0, e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0);
        return;
      }
      if (e.key === "[" || e.key === "]") {
        const d = e.key === "]" ? 1 : -1;
        if (s.tool === "text") s.setTs({ fontSize: Math.max(8, Math.min(120, s.ts.fontSize + d * 2)) });
        else s.setTs({ size: Math.max(1, Math.min(20, s.ts.size + d)) });
        return;
      }
      if (k === "b" && !e.shiftKey && !e.altKey) {
        s.setTool("background");
        return;
      }
      if (k === "f" && !e.altKey) {
        // F toggles fill for rectangles / ellipses
        s.setTs({ fill: !s.ts.fill });
        return;
      }
      const tool = TOOL_KEYS[k];
      if (tool && !e.altKey) s.setTool(tool);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pasteFromClipboard, showFlash]);

  if (!loaded || !st.doc) {
    return <div className="h-full flex items-center justify-center text-[var(--text-2)]">Loading…</div>;
  }

  return (
    <div className="h-full flex flex-col text-[var(--text)]">
      {/* toolbar */}
      <div className="h-[52px] shrink-0 flex items-center gap-0.5 pl-[84px] pr-3 border-b border-[var(--border)] bg-[var(--win-bg)]" data-tauri-drag-region>
        {TOOLS.map((t) => (
          <ToolBtn key={t.id} active={st.tool === t.id} title={`${t.label} (${t.key})`} onClick={() => st.setTool(t.id)}>
            {t.icon}
          </ToolBtn>
        ))}
        <div className="w-px h-5 bg-[var(--border)] mx-1.5" />
        <ToolBtn active={st.bgPanel} title="Background Tool (B)" onClick={() => st.setTool("background")}>
          <Frame size={17} />
        </ToolBtn>
        <ToolBtn title="Add image" onClick={addImageMenu}>
          <ImagePlus size={17} />
        </ToolBtn>
        <div className="flex-1 h-full" data-tauri-drag-region />
        <ToolBtn title="Undo (⌘Z)" onClick={() => st.undo()} disabled={!st.past.length}>
          <Undo2 size={16} />
        </ToolBtn>
        <ToolBtn title="Redo (⇧⌘Z)" onClick={() => st.redo()} disabled={!st.future.length}>
          <Redo2 size={16} />
        </ToolBtn>
        <button onClick={zoomMenu} className="h-[28px] px-2 rounded-[7px] text-[12px] tabular-nums text-[var(--text-2)] hover:bg-[var(--hover)] no-drag" title="Zoom">
          {Math.round(st.zoom * 100)}%
        </button>
        <ToolBtn title="More" onClick={moreMenu}>
          <Ellipsis size={17} />
        </ToolBtn>
        <div className="w-px h-5 bg-[var(--border)] mx-1.5" />
        <div
          title="Drag me into any app"
          onPointerDown={(e) => {
            e.preventDefault();
            actions.dragOut();
          }}
          className="h-[28px] px-2 shrink-0 whitespace-nowrap rounded-[7px] flex items-center gap-1 text-[12px] font-medium text-[var(--text-2)] hover:bg-[var(--hover)] cursor-grab"
        >
          <GripVertical size={14} /> Drag me
        </div>
        <ToolBtn title="Share" onClick={(e) => actions.share(e.clientX, e.clientY)}>
          <Share size={16} />
        </ToolBtn>
        <ToolBtn title="Pin to the screen (⇧⌘P)" onClick={() => actions.pin()}>
          <Pin size={16} />
        </ToolBtn>
        <button
          onClick={async () => {
            await actions.copy();
            showFlash("Copied");
          }}
          className="ml-1 h-[28px] px-3 rounded-[7px] text-[12.5px] font-medium bg-[var(--control)] border border-[var(--control-border)] hover:brightness-95 dark:hover:brightness-125 flex items-center gap-1.5"
          title="Copy to clipboard (⌘C)"
        >
          <Copy size={13} /> Copy
        </button>
        <button
          onClick={(e) => actions.save({ close: !e.altKey })}
          onContextMenu={(e) => {
            e.preventDefault();
            actions.saveAs();
          }}
          className="ml-1.5 h-[28px] px-3 rounded-[7px] text-[12.5px] font-semibold bg-[var(--accent)] text-white hover:brightness-110 flex items-center gap-1.5"
          title="Save (⌘S) — ⌥-click to keep the window open, right-click for Save As"
        >
          <Download size={13} /> Save
        </button>
      </div>
      <OptionsBar />
      <div className="flex-1 flex min-h-0 relative">
        <AnnotateCanvas />
        {st.bgPanel && <BackgroundPanel />}
        {flash && (
          <div className="absolute left-1/2 bottom-6 -translate-x-1/2 hud rounded-xl px-4 py-2 text-[13px] font-medium pointer-events-none" style={{ animation: "pop-in .15s ease-out" }}>
            {flash}
          </div>
        )}
      </div>
      {resizeOpen && <ResizeDialog onClose={() => setResizeOpen(false)} />}
    </div>
  );
}

function ToolBtn({ children, active, title, onClick, disabled }: { children: React.ReactNode; active?: boolean; title: string; onClick: (e: React.MouseEvent) => void; disabled?: boolean }) {
  return (
    <button
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={clsx(
        "w-[32px] h-[30px] rounded-[7px] flex items-center justify-center transition-colors disabled:opacity-30",
        active ? "bg-[var(--accent)] text-white shadow-sm" : "text-[var(--text)] hover:bg-[var(--hover)]",
      )}
    >
      {children}
    </button>
  );
}
