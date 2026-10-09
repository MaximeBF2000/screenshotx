import { params } from "../../lib/ipc";
import { DimOutside } from "../../components/Dim";

/** Outline (and optional dim) around the recorded area. Excluded from the recording. */
export default function Frame() {
  const x = Number(params.get("x"));
  const y = Number(params.get("y"));
  const w = Number(params.get("w"));
  const h = Number(params.get("h"));
  const dim = params.get("dim") === "true";
  const full = x <= 0 && y <= 0 && w >= window.innerWidth - 1 && h >= window.innerHeight - 1;
  if (full && !dim) return null;
  return (
    <div className="fixed inset-0 pointer-events-none">
      {dim && <DimOutside x={x} y={y} w={w} h={h} opacity={0.5} />}
      <div
        className="absolute"
        style={{
          left: x - 2,
          top: y - 2,
          width: w + 4,
          height: h + 4,
          border: full ? undefined : "2px dashed rgba(255,255,255,0.75)",
          outline: full ? undefined : "1px solid rgba(0,0,0,0.25)",
          borderRadius: 3,
        }}
      />
    </div>
  );
}
