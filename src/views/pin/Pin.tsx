import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Lock, X, Ellipsis } from "lucide-react";
import { basename, closeSelf, fileUrl, invoke, listenHere, params, windowLabel } from "../../lib/ipc";
import { popupMenu } from "../../lib/menu";

const path = params.get("path") ?? "";
const scale = Number(params.get("scale") ?? 1);

export default function Pin() {
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);
  const [opacity, setOpacity] = useState(1);
  const [hover, setHover] = useState(false);
  const [hud, setHud] = useState<string | null>(null);
  const [locked, setLocked] = useState(false);
  const hudTimer = useRef<number | null>(null);
  const frame = useRef<[number, number, number, number] | null>(null);

  const flash = (t: string) => {
    setHud(t);
    if (hudTimer.current) window.clearTimeout(hudTimer.current);
    hudTimer.current = window.setTimeout(() => setHud(null), 900);
  };

  const getFrame = async () => {
    const f = await invoke<[number, number, number, number]>("window_frame");
    frame.current = f;
    return f;
  };

  /** Resize keeping the aspect ratio, anchored at (ax, ay) in window coords. */
  const resizeTo = useCallback(
    async (newW: number, ax?: number, ay?: number) => {
      if (!natural) return;
      const [x, y, w, h] = frame.current ?? (await getFrame());
      const ratio = natural.w / natural.h;
      const nw = Math.max(48, Math.min(natural.w * 4, newW));
      const nh = nw / ratio;
      const fx = (ax ?? w / 2) / w;
      const fy = (ay ?? h / 2) / h;
      const nx = x + (w - nw) * fx;
      const ny = y + (h - nh) * fy;
      frame.current = [nx, ny, nw, nh];
      await invoke("set_window_frame", { x: nx, y: ny, w: nw, h: nh });
      flash(`${Math.round((nw / natural.w) * 100)}%`);
    },
    [natural],
  );

  useEffect(() => {
    const img = new Image();
    img.onload = () => setNatural({ w: img.naturalWidth / scale, h: img.naturalHeight / scale });
    img.src = fileUrl(path);
    const un = listenHere<boolean>("pin:locked", (l) => {
      setLocked(l);
      flash(l ? "Locked — hold ⌥ to interact" : "Unlocked");
    });
    // hover from the native tracker (no hover events while the app is inactive)
    const un2 = listenHere<[number, number] | null>("hover", (pos) => setHover(!!pos));
    return () => {
      un.then((f) => f());
      un2.then((f) => f());
    };
  }, []);

  const copy = () => invoke("copy_file_to_clipboard", { path }).then(() => flash("Copied"));
  const saveAs = async () => {
    const dir = await invoke<string>("export_dir");
    const p = await saveDialog({ defaultPath: `${dir}/${basename(path)}` });
    if (p) {
      const bytes = await invoke<ArrayBuffer>("read_file_bytes", { path });
      await invoke("write_file_bytes", new Uint8Array(bytes), { headers: { path: encodeURIComponent(p) } });
      flash("Saved");
    }
  };
  const setLock = (l: boolean) => invoke("pin_set_locked", { label: windowLabel(), locked: l });

  const menu = (at?: { x: number; y: number }) =>
    popupMenu(
      [
        { label: "Copy", accelerator: "Cmd+C", action: copy },
        { label: "Save As...", accelerator: "Cmd+S", action: saveAs },
        { label: "Open in Annotate", action: () => invoke("annotate_open", { path }) },
        { label: "Show in Finder", action: () => invoke("reveal", { path }) },
        "separator",
        {
          label: "Opacity",
          items: [100, 90, 75, 50, 25].map((o) => ({ label: `${o}%`, checked: Math.round(opacity * 100) === o, action: () => setOpacity(o / 100) })),
        },
        {
          label: "Size",
          items: [
            { label: "Original Size", accelerator: "Cmd+0", action: () => resizeTo(natural?.w ?? 400) },
            { label: "Half Size", action: () => resizeTo((natural?.w ?? 400) / 2) },
            { label: "Double Size", action: () => resizeTo((natural?.w ?? 400) * 2) },
          ],
        },
        { label: "Lock (Click Through)", accelerator: "L", action: () => setLock(true) },
        "separator",
        { label: "Close", accelerator: "Escape", action: closeSelf },
        { label: "Close All Pins", action: () => invoke("run_action", { id: "closeAllPins" }) },
      ],
      at,
    );

  useEffect(() => {
    const onKey = async (e: KeyboardEvent) => {
      const meta = e.metaKey;
      if (e.key === "Escape" || (meta && e.key === "w")) closeSelf();
      else if (meta && e.key === "c") copy();
      else if (meta && e.key === "s") (e.preventDefault(), saveAs());
      else if (meta && (e.key === "=" || e.key === "+")) {
        const [, , w] = await getFrame();
        resizeTo(w * 1.1);
      } else if (meta && e.key === "-") {
        const [, , w] = await getFrame();
        resizeTo(w / 1.1);
      } else if (meta && e.key === "0") resizeTo(natural?.w ?? 400);
      else if (e.key === "l" && !meta) setLock(true);
      else if (e.key.startsWith("Arrow")) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const [x, y, w, h] = await getFrame();
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        frame.current = [x + dx, y + dy, w, h];
        invoke("set_window_frame", { x: x + dx, y: y + dy, w, h });
      } else if (/^[0-9]$/.test(e.key) && !meta) {
        // 1…9 = 10%…90%, 0 = 100%
        const pct = e.key === "0" ? 100 : Number(e.key) * 10;
        setOpacity(pct / 100);
        flash(`Opacity ${pct}%`);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [natural, resizeTo]);

  return (
    <div
      className="w-full h-full relative overflow-hidden rounded-[6px]"
      style={{ opacity }}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onWheel={async (e) => {
        if (!natural) return;
        const [, , w] = frame.current ?? (await getFrame());
        const k = Math.exp(-(e.deltaY || -e.deltaX * 0) * (e.ctrlKey ? 0.012 : 0.004));
        resizeTo(w * k, e.clientX, e.clientY);
      }}
      onMouseDown={(e) => {
        if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
        frame.current = null;
        getCurrentWebviewWindow().startDragging();
      }}
      onDoubleClick={() => invoke("annotate_open", { path })}
      onContextMenu={(e) => {
        e.preventDefault();
        menu();
      }}
    >
      <img src={fileUrl(path)} draggable={false} className="w-full h-full object-fill select-none pointer-events-none" />
      <div className="absolute inset-0 pointer-events-none rounded-[6px]" style={{ boxShadow: "inset 0 0 0 0.5px rgba(0,0,0,0.25)" }} />
      <div className="absolute inset-x-0 top-0 flex justify-between p-1.5 transition-opacity duration-150" style={{ opacity: hover ? 1 : 0 }}>
        <button title="Close (Esc)" onClick={closeSelf} className="w-6 h-6 rounded-full hud flex items-center justify-center hover:bg-black/70">
          <X size={12} strokeWidth={2.6} />
        </button>
        <div className="flex gap-1">
          <button title="Lock — click through (L)" onClick={() => setLock(true)} className="w-6 h-6 rounded-full hud flex items-center justify-center hover:bg-black/70">
            <Lock size={11} />
          </button>
          <button title="More" onClick={(e) => menu({ x: e.clientX, y: e.clientY })} className="w-6 h-6 rounded-full hud flex items-center justify-center hover:bg-black/70">
            <Ellipsis size={12} />
          </button>
        </div>
      </div>
      {(hud || locked) && (
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 hud rounded-lg px-3 py-1.5 text-[12px] font-medium whitespace-nowrap pointer-events-none" style={{ opacity: hud ? 1 : 0, transition: "opacity .3s" }}>
          {hud}
        </div>
      )}
    </div>
  );
}
