/** Darken everything except a rectangle, using four plain rectangles
 * (renders reliably in transparent WKWebView windows). */
export function DimOutside({ x, y, w, h, opacity = 0.4 }: { x: number; y: number; w: number; h: number; opacity?: number; radius?: number }) {
  const bg = `rgba(0,0,0,${opacity})`;
  const common: React.CSSProperties = { position: "fixed", background: bg, pointerEvents: "none" };
  return (
    <>
      <div style={{ ...common, left: 0, top: 0, right: 0, height: Math.max(0, y) }} />
      <div style={{ ...common, left: 0, top: y + h, right: 0, bottom: 0 }} />
      <div style={{ ...common, left: 0, top: y, width: Math.max(0, x), height: h }} />
      <div style={{ ...common, left: x + w, top: y, right: 0, height: h }} />
    </>
  );
}
