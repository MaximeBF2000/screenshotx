import { useState } from "react";
import { Link2, Link2Off } from "lucide-react";
import { Button, NumberField } from "../../components/ui";
import { useAnnotate } from "./store";

export function ResizeDialog({ onClose }: { onClose: () => void }) {
  const st = useAnnotate();
  const c = st.doc!.canvas;
  const [w, setW] = useState(Math.round(c.w));
  const [h, setH] = useState(Math.round(c.h));
  const [lock, setLock] = useState(true);
  const ratio = c.w / c.h;
  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center pt-24 bg-black/20" onMouseDown={onClose}>
      <div className="w-[320px] rounded-xl bg-[var(--panel)] border border-[var(--border-strong)] shadow-2xl p-4" style={{ animation: "pop-in .15s ease-out" }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="font-semibold text-[13px] mb-3">Resize Image</div>
        <div className="flex items-center gap-2">
          <span className="text-[12px] text-[var(--text-2)] w-12">Width</span>
          <NumberField value={w} min={1} max={20000} width={72} suffix="pt" onChange={(v) => { setW(v); if (lock) setH(Math.round(v / ratio)); }} />
        </div>
        <div className="flex items-center gap-2 mt-2">
          <span className="text-[12px] text-[var(--text-2)] w-12">Height</span>
          <NumberField value={h} min={1} max={20000} width={72} suffix="pt" onChange={(v) => { setH(v); if (lock) setW(Math.round(v * ratio)); }} />
          <button className="ml-1 text-[var(--text-2)] hover:text-[var(--text)]" title="Keep aspect ratio" onClick={() => setLock(!lock)}>
            {lock ? <Link2 size={15} /> : <Link2Off size={15} />}
          </button>
        </div>
        <div className="flex gap-1.5 mt-3">
          {[25, 50, 75].map((p) => (
            <Button small key={p} onClick={() => { setW(Math.round((c.w * p) / 100)); setH(Math.round((c.h * p) / 100)); }}>
              {p}%
            </Button>
          ))}
        </div>
        <p className="text-[11.5px] text-[var(--text-2)] mt-3 leading-snug">
          Resizing flattens the annotations into the image.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button onClick={onClose}>Cancel</Button>
          <Button primary onClick={() => { st.resize(w, h); onClose(); }}>
            Resize
          </Button>
        </div>
      </div>
    </div>
  );
}
