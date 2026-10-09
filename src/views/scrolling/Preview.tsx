import { useEffect, useRef, useState } from "react";
import { ArrowDownToLine, Check, X } from "lucide-react";
import { fileUrl, invoke, listenHere, params } from "../../lib/ipc";

/** Live preview of a scrolling capture, beside the captured area. */
export default function Preview() {
  const [img, setImg] = useState<{ path: string; w: number; h: number; t: number } | null>(null);
  const [auto, setAuto] = useState(params.get("auto") === "true");
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<[string, number, number, number] | null>("scroll_preview").then((p) => p && setImg({ path: p[0], w: p[1], h: p[2], t: p[3] }));
    const un = listenHere<[string, number, number, number]>("scroll:preview", ([path, w, h, t]) => setImg({ path, w, h, t }));
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") invoke("scroll_control", { action: "cancel" });
      if (e.key === "Enter") invoke("scroll_control", { action: "finish" });
    };
    window.addEventListener("keydown", onKey);
    return () => {
      un.then((f) => f());
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [img?.t]);

  const grown = img && img.h > img.w * 0.2 && img.t;
  return (
    <div className="w-full h-full p-2">
      <div className="w-full h-full hud rounded-2xl flex flex-col overflow-hidden shadow-2xl">
        <div className="px-3 pt-2.5 pb-2 flex items-center justify-between">
          <span className="text-[12.5px] font-semibold">Scrolling Capture</span>
          {img && <span className="text-[11px] text-white/60 tabular-nums">{img.w} × {img.h}</span>}
        </div>
        <div ref={scroller} className="flex-1 overflow-y-auto px-3">
          {img ? (
            <img src={fileUrl(img.path, img.t)} className="w-full rounded-md shadow-lg" draggable={false} />
          ) : (
            <div className="h-full flex items-center justify-center text-white/60 text-[12px]">Preparing…</div>
          )}
        </div>
        {!grown && <div className="px-3 pt-2 text-[11.5px] text-white/70 text-center">{auto ? "Scrolling automatically…" : "Slowly scroll down the content"}</div>}
        <div className="p-2.5 flex items-center gap-1.5">
          <button
            title="Scroll automatically"
            onClick={() => {
              setAuto(!auto);
              invoke("scroll_control", { action: auto ? "autoscrollOff" : "autoscrollOn" });
            }}
            className={`h-8 px-2.5 rounded-lg text-[12px] font-medium flex items-center gap-1 ${auto ? "bg-white/25" : "bg-white/10 hover:bg-white/18"}`}
          >
            <ArrowDownToLine size={13} /> Auto
          </button>
          <div className="flex-1" />
          <button title="Cancel (Esc)" onClick={() => invoke("scroll_control", { action: "cancel" })} className="w-8 h-8 rounded-lg bg-white/10 hover:bg-white/18 flex items-center justify-center">
            <X size={15} />
          </button>
          <button title="Done (↩)" onClick={() => invoke("scroll_control", { action: "finish" })} className="h-8 px-3 rounded-lg bg-[var(--accent)] hover:brightness-110 text-white text-[12.5px] font-semibold flex items-center gap-1">
            <Check size={14} /> Done
          </button>
        </div>
      </div>
    </div>
  );
}
