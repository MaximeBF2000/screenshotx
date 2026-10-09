export type Tool =
  | "move"
  | "crop"
  | "rect"
  | "ellipse"
  | "line"
  | "arrow"
  | "text"
  | "pixelate"
  | "spotlight"
  | "counter"
  | "pen"
  | "highlighter"
  | "background";

export type ArrowStyle = "standard" | "fancy" | "double" | "curved";
export type PixelateStyle = "pixelate" | "blur" | "smooth" | "blackout";
export type CounterStyle = "numbers" | "upper" | "lower" | "roman" | "romanLower";
export type Shape = "rect" | "ellipse";

export interface Pt {
  x: number;
  y: number;
}

interface Base {
  id: string;
  color: string;
  size: number;
  shadow: boolean;
}

export interface BoxObj extends Base {
  /** "filledRect" is kept for older projects; new shapes use `fill` */
  type: "rect" | "filledRect" | "ellipse" | "spotlight" | "pixelate" | "highlightRect";
  x: number;
  y: number;
  w: number;
  h: number;
  /** rectangles & ellipses: solid instead of outlined */
  fill?: boolean;
  radius?: number;
  pixelate?: PixelateStyle;
  intensity?: number;
  shape?: Shape;
}

export interface LineObj extends Base {
  type: "line" | "arrow";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** control point for curved arrows */
  cx?: number;
  cy?: number;
  style?: ArrowStyle;
}

export interface PathObj extends Base {
  type: "pen" | "highlighter";
  points: Pt[];
}

export interface TextObj extends Base {
  type: "text";
  x: number;
  y: number;
  text: string;
  style: number;
  fontSize: number;
  align: "left" | "center" | "right";
  /** fixed wrap width (0 = auto) */
  width: number;
}

export interface CounterObj extends Base {
  type: "counter";
  x: number;
  y: number;
  value: number;
  style: CounterStyle;
}

export interface ImageObj extends Base {
  type: "image";
  x: number;
  y: number;
  w: number;
  h: number;
  /** key into the image cache */
  src: string;
  border: boolean;
}

export type Obj = BoxObj | LineObj | PathObj | TextObj | CounterObj | ImageObj;

export interface CanvasRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type BgKind = "gradient" | "color" | "image" | "wallpaper" | "blurredWallpaper";
export type Align = "tl" | "t" | "tr" | "l" | "c" | "r" | "bl" | "b" | "br";

export interface Background {
  enabled: boolean;
  kind: BgKind;
  /** gradient id, css color, or image key */
  value: string;
  padding: number;
  inset: number;
  /** color of the inset band; empty = the screenshot's edge color */
  insetColor?: string;
  autoBalance: boolean;
  shadow: number;
  radius: number;
  align: Align;
  /** null = auto (fit content) */
  ratio: number | null;
}

export interface BgPreset extends Omit<Background, "enabled"> {
  id: string;
  name: string;
}

export interface Doc {
  /** key of the base image in the image cache */
  base: string;
  /** base image size in points */
  baseW: number;
  baseH: number;
  /** pixels per point of the base image (Retina = 2) */
  scale: number;
  canvas: CanvasRect;
  objects: Obj[];
  background: Background;
}

export const DEFAULT_BACKGROUND: Background = {
  enabled: false,
  kind: "gradient",
  value: "g-sunset",
  padding: 64,
  inset: 0,
  autoBalance: false,
  shadow: 50,
  radius: 12,
  align: "c",
  ratio: null,
};

export interface NamedColor {
  name: string;
  value: string;
}

export const COLORS: NamedColor[] = [
  { name: "Red", value: "#FF3B30" },
  { name: "Orange", value: "#FF9500" },
  { name: "Yellow", value: "#FFCC00" },
  { name: "Green", value: "#34C759" },
  { name: "Turquoise", value: "#00C7BE" },
  { name: "Light Blue", value: "#32ADE6" },
  { name: "Blue", value: "#007AFF" },
  { name: "Violet", value: "#5856D6" },
  { name: "Purple", value: "#AF52DE" },
  { name: "Pink", value: "#FF2D55" },
  { name: "Black", value: "#000000" },
  { name: "Dark Gray", value: "#3A3A3C" },
  { name: "Light Gray", value: "#C7C7CC" },
  { name: "White", value: "#FFFFFF" },
  { name: "Light Red", value: "#FF8A80" },
  { name: "Light Orange", value: "#FFC27A" },
  { name: "Light Yellow", value: "#FFE680" },
  { name: "Light Green", value: "#9BE6A8" },
  { name: "Light Violet", value: "#B3B1F0" },
  { name: "Transparent", value: "transparent" },
];

export interface Gradient {
  id: string;
  angle: number;
  stops: [string, number][];
}

export const GRADIENTS: Gradient[] = [
  { id: "g-sunset", angle: 135, stops: [["#FF6B6B", 0], ["#FFB86B", 0.5], ["#FFE29A", 1]] },
  { id: "g-ocean", angle: 135, stops: [["#2E3192", 0], ["#1BFFFF", 1]] },
  { id: "g-violet", angle: 135, stops: [["#7F00FF", 0], ["#E100FF", 1]] },
  { id: "g-peach", angle: 120, stops: [["#FFDEE9", 0], ["#B5FFFC", 1]] },
  { id: "g-mint", angle: 135, stops: [["#43E97B", 0], ["#38F9D7", 1]] },
  { id: "g-dusk", angle: 160, stops: [["#2C3E50", 0], ["#4CA1AF", 1]] },
  { id: "g-candy", angle: 135, stops: [["#F093FB", 0], ["#F5576C", 1]] },
  { id: "g-sky", angle: 180, stops: [["#89F7FE", 0], ["#66A6FF", 1]] },
  { id: "g-flame", angle: 135, stops: [["#F83600", 0], ["#F9D423", 1]] },
  { id: "g-lavender", angle: 135, stops: [["#A18CD1", 0], ["#FBC2EB", 1]] },
  { id: "g-night", angle: 135, stops: [["#0F2027", 0], ["#203A43", 0.5], ["#2C5364", 1]] },
  { id: "g-aurora", angle: 135, stops: [["#00C9FF", 0], ["#92FE9D", 1]] },
  { id: "g-rose", angle: 135, stops: [["#EE9CA7", 0], ["#FFDDE1", 1]] },
  { id: "g-cosmic", angle: 135, stops: [["#FF00CC", 0], ["#333399", 1]] },
  { id: "g-lemon", angle: 135, stops: [["#FDFC47", 0], ["#24FE41", 1]] },
  { id: "g-steel", angle: 160, stops: [["#BDC3C7", 0], ["#2C3E50", 1]] },
  { id: "g-coral", angle: 135, stops: [["#FF9A8B", 0], ["#FF6A88", 0.55], ["#FF99AC", 1]] },
  { id: "g-indigo", angle: 135, stops: [["#4776E6", 0], ["#8E54E9", 1]] },
  { id: "g-sand", angle: 135, stops: [["#E6DADA", 0], ["#274046", 1]] },
  { id: "g-mono", angle: 135, stops: [["#ECE9E6", 0], ["#FFFFFF", 1]] },
];

export const TEXT_STYLES = ["Standard", "Outline", "Box", "Rounded Box", "Monospaced", "Monospaced Box", "Rounded"];

export const COUNTER_STYLES: { id: CounterStyle; label: string }[] = [
  { id: "numbers", label: "1, 2, 3 ..." },
  { id: "upper", label: "A, B, C, D ..." },
  { id: "lower", label: "a, b, c, d ..." },
  { id: "roman", label: "I, II, III, IV ..." },
  { id: "romanLower", label: "i, ii, iii, iv ..." },
];

export const ASPECT_RATIOS: { label: string; value: number | null }[] = [
  { label: "Auto", value: null },
  { label: "1:1", value: 1 },
  { label: "4:3", value: 4 / 3 },
  { label: "3:2", value: 3 / 2 },
  { label: "16:9", value: 16 / 9 },
  { label: "16:10", value: 16 / 10 },
  { label: "4:5 (Instagram)", value: 4 / 5 },
  { label: "9:16 (Story)", value: 9 / 16 },
  { label: "3:4", value: 3 / 4 },
  { label: "2:1 (X / Twitter)", value: 2 },
  { label: "1.91:1 (Open Graph)", value: 1.91 },
];

export const TOOL_KEYS: Record<string, Tool> = {
  v: "move",
  c: "crop",
  r: "rect",
  o: "ellipse",
  e: "ellipse",
  l: "line",
  a: "arrow",
  t: "text",
  p: "pixelate",
  b: "pixelate",
  s: "spotlight",
  n: "counter",
  d: "pen",
  h: "highlighter",
};

export interface ToolSettings {
  color: string;
  /** highlighter has its own color (with opacity) */
  highlightColor: string;
  /** rectangle / ellipse: filled shape */
  fill: boolean;
  size: number;
  shadow: boolean;
  arrowStyle: ArrowStyle;
  textStyle: number;
  fontSize: number;
  textAlign: "left" | "center" | "right";
  pixelate: PixelateStyle;
  intensity: number;
  spotlightShape: Shape;
  highlightShape: "free" | "rect";
  counterStyle: CounterStyle;
  rectRadius: number;
}

export const DEFAULT_TOOL_SETTINGS: ToolSettings = {
  color: "#FF3B30",
  highlightColor: "#FFD60A80",
  fill: false,
  size: 4,
  shadow: true,
  arrowStyle: "standard",
  textStyle: 0,
  fontSize: 22,
  textAlign: "left",
  pixelate: "pixelate",
  intensity: 10,
  spotlightShape: "rect",
  highlightShape: "free",
  counterStyle: "numbers",
  rectRadius: 4,
};

export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function counterLabel(n: number, style: CounterStyle): string {
  const letters = (k: number) => {
    let s = "";
    k = Math.max(1, k);
    while (k > 0) {
      const r = (k - 1) % 26;
      s = String.fromCharCode(65 + r) + s;
      k = Math.floor((k - 1) / 26);
    }
    return s;
  };
  const roman = (k: number) => {
    const map: [number, string][] = [
      [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
      [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
    ];
    let s = "";
    for (const [v, r] of map) while (k >= v) { s += r; k -= v; }
    return s || "0";
  };
  switch (style) {
    case "upper": return letters(n);
    case "lower": return letters(n).toLowerCase();
    case "roman": return roman(n);
    case "romanLower": return roman(n).toLowerCase();
    default: return String(n);
  }
}
