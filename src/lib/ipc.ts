import { invoke as tauriInvoke } from "@tauri-apps/api/core";
import { listen as tauriListen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export type CaptureKind = "screenshot" | "video" | "gif";

export interface CaptureItem {
  id: string;
  kind: CaptureKind;
  path: string;
  width: number;
  height: number;
  scale: number;
  created: number;
  size: number;
  duration?: number | null;
  thumb: string;
  saved: boolean;
  appName: string;
  ocrText?: string | null;
}

export interface Display {
  id: number;
  index: number;
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
  isMain: boolean;
}

export interface WinInfo {
  id: number;
  pid: number;
  owner: string;
  title: string;
  layer: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SavedArea {
  displayId: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Mode = "area" | "window" | "allInOne" | "scrolling" | "record" | "ocr" | "selfTimer";

export interface OverlayPayload {
  sessionId: number;
  mode: Mode;
  display: Display;
  imageUrl: string;
  windows: WinInfo[];
  mouse: [number, number] | null;
  crosshair: "always" | "whenCommandPressed" | "disabled";
  magnifier: boolean;
  freeze: boolean;
  preset: SavedArea | null;
  remember: SavedArea | null;
  recordKind: "video" | "gif";
  settings: Record<string, any>;
  accent: string;
}

export interface Toast {
  id: string;
  kind: string;
  title: string;
  body: string;
  actions: { id: string; label: string }[];
  durationMs: number;
}

const mocks: Record<string, (args: any) => any> = {};
export function registerMock(cmd: string, fn: (args: any) => any) {
  mocks[cmd] = fn;
}

export async function invoke<T = any>(cmd: string, args?: any, options?: any): Promise<T> {
  if (!isTauri) {
    const m = mocks[cmd];
    if (m) return m(args);
    console.debug("[mock invoke]", cmd, args);
    return undefined as T;
  }
  return tauriInvoke<T>(cmd, args, options);
}

export async function listen<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return tauriListen<T>(event, (e) => cb(e.payload));
}

/** Listen to an event targeted at (or broadcast to) the current window. */
export async function listenHere<T>(event: string, cb: (payload: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return () => {};
  return getCurrentWebviewWindow().listen<T>(event, (e) => cb(e.payload));
}

export function windowLabel(): string {
  if (!isTauri) return "browser";
  return getCurrentWebviewWindow().label;
}

export const params = new URLSearchParams(window.location.search);

/** URL for a local file usable in <img>/<video> and fetch() (CORS-enabled). */
export function fileUrl(path: string, bust?: string | number): string {
  if (!path) return "";
  if (!isTauri) return path;
  return `sx://localhost/file?p=${encodeURIComponent(path)}${bust ? `&t=${bust}` : ""}`;
}

export async function readFileBytes(path: string): Promise<ArrayBuffer> {
  if (!isTauri) {
    const r = await fetch(path);
    return r.arrayBuffer();
  }
  return tauriInvoke<ArrayBuffer>("read_file_bytes", { path });
}

/** Send canvas PNG bytes to Rust, re-encoded in `format`. Returns the path. */
export async function savePng(
  bytes: Uint8Array,
  opts: { path?: string; format?: string; scale?: number; dir?: "export" | "captures" | "temp"; stem?: string },
): Promise<string> {
  const headers: Record<string, string> = {};
  if (opts.path) headers.path = encodeURIComponent(opts.path);
  if (opts.format) headers.format = opts.format;
  if (opts.scale) headers.scale = String(opts.scale);
  if (opts.dir) headers.dir = opts.dir;
  if (opts.stem) headers.stem = encodeURIComponent(opts.stem);
  return invoke<string>("save_png_as", bytes, { headers });
}

export async function writeFileBytes(path: string, bytes: Uint8Array): Promise<void> {
  return invoke("write_file_bytes", bytes, { headers: { path: encodeURIComponent(path) } });
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDuration(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

export function basename(p: string): string {
  return p.split("/").pop() ?? p;
}

export function ready() {
  invoke("window_ready");
}

export function closeSelf() {
  invoke("close_window", { label: windowLabel() });
}
