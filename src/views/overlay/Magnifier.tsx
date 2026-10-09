import { useEffect, useRef } from "react";
import type { Rect } from "./geometry";

const SIZE = 132; // css px
const SRC = 17; // source pixels shown per side (odd → center pixel)

/** Zoomed loupe that follows the cursor (pixels from the session snapshot). */
export function Magnifier({
  img,
  mouse,
  W,
  H,
  scale,
  sel,
}: {
  img: HTMLImageElement | null;
  mouse: { x: number; y: number };
  W: number;
  H: number;
  scale: number;
  sel: Rect | null;
}) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const c = ref.current;
    if (!c || !img || !img.naturalWidth) return;
    const dpr = window.devicePixelRatio || 2;
    c.width = SIZE * dpr;
    c.height = SIZE * dpr;
    const ctx = c.getContext("2d")!;
    ctx.imageSmoothingEnabled = false;
    const k = img.naturalWidth / W; // image px per point
    const cx = Math.floor(mouse.x * k);
    const cy = Math.floor(mouse.y * k);
    const half = Math.floor(SRC / 2);
    const cell = (SIZE * dpr) / SRC;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(img, cx - half, cy - half, SRC, SRC, 0, 0, SRC * cell, SRC * cell);
    // pixel grid
    ctx.strokeStyle = "rgba(0,0,0,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 1; i < SRC; i++) {
      ctx.moveTo(Math.round(i * cell) + 0.5, 0);
      ctx.lineTo(Math.round(i * cell) + 0.5, c.height);
      ctx.moveTo(0, Math.round(i * cell) + 0.5);
      ctx.lineTo(c.width, Math.round(i * cell) + 0.5);
    }
    ctx.stroke();
    // crosshair band through the center pixel
    ctx.globalAlpha = 0.2;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim() || "#0a84ff";
    ctx.fillRect(0, half * cell, c.width, cell);
    ctx.fillRect(half * cell, 0, cell, c.height);
    ctx.globalAlpha = 1;
    // center pixel
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 2;
    ctx.strokeRect(half * cell + 1, half * cell + 1, cell - 2, cell - 2);
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 1;
    ctx.strokeRect(half * cell - 0.5, half * cell - 0.5, cell + 1, cell + 1);
  }, [img, mouse.x, mouse.y, W]);

  const off = 26;
  const boxH = SIZE + 26;
  let left = mouse.x + off;
  let top = mouse.y + off;
  if (left + SIZE > W - 4) left = mouse.x - off - SIZE;
  if (top + boxH > H - 4) top = mouse.y - off - boxH;
  const px = Math.round(mouse.x * scale);
  const py = Math.round(mouse.y * scale);
  return (
    <div className="absolute pointer-events-none" style={{ left, top, width: SIZE }}>
      <canvas
        ref={ref}
        className="block rounded-[14px]"
        style={{ width: SIZE, height: SIZE, boxShadow: "0 0 0 1px rgba(255,255,255,0.7), 0 0 0 2px rgba(0,0,0,0.25), 0 8px 24px rgba(0,0,0,0.35)" }}
      />
      <div className="mt-1.5 mx-auto w-fit hud rounded-md px-2 py-[3px] text-[11px] font-medium tabular-nums whitespace-nowrap">
        {sel && sel.w > 0 ? `${Math.round(sel.w)} × ${Math.round(sel.h)}` : `${Math.round(mouse.x)}, ${Math.round(mouse.y)}`}
        <span className="opacity-50"> {sel && sel.w > 0 ? "pt" : `· ${px}, ${py} px`}</span>
      </div>
    </div>
  );
}
