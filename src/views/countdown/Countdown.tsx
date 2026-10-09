import { useEffect, useState } from "react";
import { params } from "../../lib/ipc";

export default function Countdown() {
  const total = Number(params.get("seconds") ?? 3);
  const [n, setN] = useState(total);
  useEffect(() => {
    const t = window.setInterval(() => setN((v) => Math.max(1, v - 1)), 1000);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="relative w-[150px] h-[150px] rounded-full hud flex items-center justify-center shadow-2xl">
        <svg className="absolute inset-0 -rotate-90" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="68" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="5" />
          <circle
            cx="75"
            cy="75"
            r="68"
            fill="none"
            stroke="white"
            strokeWidth="5"
            strokeLinecap="round"
            strokeDasharray={2 * Math.PI * 68}
            strokeDashoffset={2 * Math.PI * 68 * (1 - (n - 1) / total)}
            style={{ transition: "stroke-dashoffset 1s linear" }}
          />
        </svg>
        <span key={n} className="text-white text-[64px] font-semibold tabular-nums" style={{ animation: "pop-in .3s ease-out", fontFamily: "var(--font-rounded)" }}>
          {n}
        </span>
      </div>
    </div>
  );
}
