import { useEffect, useRef, useState } from "react";
import { invoke, listen, params } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";

interface Click {
  id: number;
  x: number;
  y: number;
  down: boolean;
}
interface Key {
  id: number;
  label: string;
  count: number;
}

const dx = Number(params.get("dx"));
const dy = Number(params.get("dy"));
const area = { x: Number(params.get("x")), y: Number(params.get("y")), w: Number(params.get("w")), h: Number(params.get("h")) };

/** Click highlights and keystroke badges, drawn into the recording. */
export default function Effects() {
  const s = useSettings((st) => st.settings);
  const [clicks, setClicks] = useState<Click[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [held, setHeld] = useState<{ x: number; y: number } | null>(null);
  const [accent, setAccent] = useState("#0a84ff");
  const seq = useRef(0);

  useEffect(() => {
    invoke<string>("accent_color").then((c) => c && setAccent(c));
  }, []);

  useEffect(() => {
    if (!s) return;
    const un1 = listen<{ x: number; y: number; down: boolean }>("fx:click", (c) => {
      if (!s.recHighlightClicks) return;
      const x = c.x - dx;
      const y = c.y - dy;
      if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return;
      if (c.down) {
        const id = ++seq.current;
        setClicks((l) => [...l.slice(-8), { id, x, y, down: true }]);
        setHeld({ x, y });
        window.setTimeout(() => setClicks((l) => l.filter((k) => k.id !== id)), 650);
      } else setHeld(null);
    });
    const un2 = listen<{ label: string; hasCommandModifier: boolean }>("fx:key", (k) => {
      if (!s.recShowKeystrokes) return;
      if (s.recKeystrokeOnlyCommandKeys && !k.hasCommandModifier) return;
      setKeys((l) => {
        const last = l[l.length - 1];
        const id = ++seq.current;
        const next = last && last.label === k.label ? [...l.slice(0, -1), { ...last, id, count: last.count + 1 }] : [...l.slice(-3), { id, label: k.label, count: 1 }];
        window.setTimeout(() => setKeys((cur) => cur.filter((x) => x.id !== id)), 1600);
        return next;
      });
    });
    return () => {
      un1.then((f) => f());
      un2.then((f) => f());
    };
  }, [s]);

  if (!s) return null;
  const color = s.recClickColor || accent;
  const size = 44 * (s.recClickSize ?? 1);
  const filled = s.recClickStyle !== "outline";
  const ks = s.recKeystrokeSize ?? 1;
  const dark = s.recKeystrokeStyle !== "light";
  const pos = s.recKeystrokePosition ?? "bottomCenter";
  const kx = pos === "bottomLeft" ? area.x + 24 : pos === "bottomRight" ? area.x + area.w - 24 : area.x + area.w / 2;
  const ky = pos === "topCenter" ? area.y + 40 : area.y + area.h - 40;
  return (
    <div className="fixed inset-0 pointer-events-none overflow-hidden">
      {held && (
        <div
          className="absolute rounded-full"
          style={{ left: held.x, top: held.y, width: size * 0.75, height: size * 0.75, transform: "translate(-50%,-50%)", background: filled ? `${color}55` : undefined, border: `3px solid ${color}` }}
        />
      )}
      {clicks.map((c) => (
        <div
          key={c.id}
          className="absolute rounded-full"
          style={{
            left: c.x,
            top: c.y,
            width: size,
            height: size,
            background: filled ? `${color}66` : undefined,
            border: `3px solid ${color}`,
            animation: s.recClickAnimate ? "click-ring .6s ease-out forwards" : undefined,
            transform: "translate(-50%,-50%)",
          }}
        />
      ))}
      {keys.length > 0 && (
        <div
          className="absolute flex gap-2"
          style={{
            left: kx,
            top: ky,
            transform: `translate(${pos === "bottomLeft" ? "0" : pos === "bottomRight" ? "-100%" : "-50%"}, -100%)`,
          }}
        >
          {keys.map((k) => (
            <div
              key={k.id}
              className="rounded-xl font-semibold tracking-wide shadow-2xl"
              style={{
                fontSize: 22 * ks,
                padding: `${8 * ks}px ${16 * ks}px`,
                background: dark ? "rgba(20,20,22,0.82)" : "rgba(255,255,255,0.92)",
                color: dark ? "#fff" : "#111",
                border: dark ? "1px solid rgba(255,255,255,0.15)" : "1px solid rgba(0,0,0,0.1)",
                animation: "pop-in .15s ease-out",
              }}
            >
              {k.label}
              {k.count > 1 && <span style={{ opacity: 0.55, fontSize: 15 * ks }}> ×{k.count}</span>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
