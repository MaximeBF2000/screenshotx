import { useEffect, useState } from "react";
import { Pause, Play, RotateCcw, Square, Trash2 } from "lucide-react";
import { ask } from "@tauri-apps/plugin-dialog";
import { formatDuration, invoke, listen } from "../../lib/ipc";

interface RecInfo {
  kind: string;
  paused: boolean;
  elapsed: number;
  mic: boolean;
  camera: boolean;
}

export default function Controls() {
  const [info, setInfo] = useState<RecInfo | null>(null);
  useEffect(() => {
    invoke<RecInfo | null>("rec_info").then(setInfo);
    const un = listen<RecInfo>("rec:tick", setInfo);
    return () => {
      un.then((f) => f());
    };
  }, []);
  const ctl = (action: string) => invoke("rec_control", { action });
  return (
    <div className="w-full h-full flex items-center justify-center" data-tauri-drag-region>
      <div className="hud rounded-full h-[38px] pl-3 pr-1.5 flex items-center gap-1 shadow-xl" data-tauri-drag-region>
        <span className="w-2.5 h-2.5 rounded-full bg-[#ff3b30]" style={{ animation: info?.paused ? "none" : "rec-pulse 1.4s ease-in-out infinite", opacity: info?.paused ? 0.4 : 1 }} />
        <span className="text-[13px] font-medium tabular-nums w-[44px] text-center" data-tauri-drag-region>
          {formatDuration(info?.elapsed ?? 0)}
        </span>
        {info?.kind === "gif" && <span className="text-[10px] font-bold px-1 rounded bg-white/15">GIF</span>}
        <Btn title={info?.paused ? "Resume" : "Pause"} onClick={() => ctl("pause")}>
          {info?.paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
        </Btn>
        <Btn title="Restart Recording" onClick={() => ctl("restart")}>
          <RotateCcw size={14} />
        </Btn>
        <Btn
          title="Delete recording"
          onClick={async () => {
            if (await ask("Are you sure you want to delete this recording?\n\nThis operation cannot be undone.", { title: "Delete recording", kind: "warning", okLabel: "Delete" })) ctl("discard");
          }}
        >
          <Trash2 size={14} />
        </Btn>
        <button title="Stop recording" onClick={() => ctl("stop")} className="ml-0.5 h-[28px] px-3 rounded-full bg-[#ff3b30] hover:bg-[#ff5147] text-white text-[12.5px] font-semibold flex items-center gap-1.5">
          <Square size={11} fill="currentColor" /> Stop
        </button>
      </div>
    </div>
  );
}

function Btn({ children, title, onClick }: { children: React.ReactNode; title: string; onClick: () => void }) {
  return (
    <button title={title} onClick={onClick} className="w-[30px] h-[30px] rounded-full flex items-center justify-center text-white/90 hover:bg-white/15">
      {children}
    </button>
  );
}
