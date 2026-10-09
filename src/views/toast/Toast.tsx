import { useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ClipboardCheck, Info, Link2, ScanText } from "lucide-react";
import { invoke, listenHere, type Toast as T } from "../../lib/ipc";

const ICONS: Record<string, React.ReactNode> = {
  copied: <ClipboardCheck size={18} />,
  saved: <Check size={18} />,
  error: <AlertTriangle size={18} className="text-[#ffd60a]" />,
  info: <Info size={18} />,
  ocr: <ScanText size={18} />,
  link: <Link2 size={18} />,
};

export default function Toast() {
  const [t, setT] = useState<T | null>(null);
  const [hover, setHover] = useState(false);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    invoke<T | null>("toast_pending").then((p) => p && setT(p));
    const un = listenHere<T>("toast:show", (p) => setT({ ...p }));
    return () => {
      un.then((f) => f());
    };
  }, []);

  useEffect(() => {
    if (!t || hover) return;
    timer.current = window.setTimeout(() => {
      setT(null);
      invoke("toast_hide");
    }, t.durationMs);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [t, hover]);

  if (!t) return null;
  return (
    <div className="w-full h-full flex justify-center items-start pt-1">
      <div
        key={t.id}
        className="hud rounded-2xl px-4 py-3 shadow-2xl max-w-[360px] min-w-[220px]"
        style={{ animation: "pop-in .2s ease-out" }}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        onClick={() => {
          if (!t.actions.length) {
            setT(null);
            invoke("toast_hide");
          }
        }}
      >
        <div className="flex items-start gap-3">
          <div className="mt-0.5 opacity-90">{ICONS[t.kind] ?? ICONS.info}</div>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold leading-tight">{t.title}</div>
            {t.body && <div className="text-[12px] text-white/70 mt-0.5 leading-snug line-clamp-3 break-words whitespace-pre-line">{t.body}</div>}
          </div>
        </div>
        {t.actions.length > 0 && (
          <div className="flex gap-2 mt-2.5 justify-end">
            {t.actions.map((a, i) => (
              <button
                key={a.id}
                onClick={() => {
                  invoke("toast_action", { action: a.id });
                  setT(null);
                }}
                className={i === 0 ? "h-7 px-3 rounded-lg bg-[var(--accent)] text-white text-[12px] font-semibold hover:brightness-110" : "h-7 px-3 rounded-lg bg-white/12 text-white text-[12px] font-medium hover:bg-white/20"}
              >
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
