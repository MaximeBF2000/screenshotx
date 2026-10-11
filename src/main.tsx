import { lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { invoke, isTauri, params, registerMock } from "./lib/ipc";
import { initSettings } from "./lib/settings";

const views: Record<string, React.LazyExoticComponent<() => React.ReactElement | null>> = {
  overlay: lazy(() => import("./views/overlay/Overlay")),
  quickaccess: lazy(() => import("./views/quickaccess/QuickAccess")),
  toast: lazy(() => import("./views/toast/Toast")),
  countdown: lazy(() => import("./views/countdown/Countdown")),
  pin: lazy(() => import("./views/pin/Pin")),
  annotate: lazy(() => import("./views/annotate/Annotate")),
  renderer: lazy(() => import("./views/annotate/Renderer")),
  prefs: lazy(() => import("./views/prefs/Prefs")),
  history: lazy(() => import("./views/history/History")),
  onboarding: lazy(() => import("./views/onboarding/Onboarding")),
  video: lazy(() => import("./views/video/VideoEditor")),
  recctl: lazy(() => import("./views/recording/Controls")),
  recfx: lazy(() => import("./views/recording/Effects")),
  recframe: lazy(() => import("./views/recording/Frame")),
  camera: lazy(() => import("./views/recording/Camera")),
  scrollprev: lazy(() => import("./views/scrolling/Preview")),
};

const TRANSPARENT = new Set(["overlay", "quickaccess", "toast", "countdown", "pin", "recctl", "recfx", "recframe", "camera", "scrollprev", "renderer"]);

const view = params.get("view") ?? "prefs";
document.body.classList.add(TRANSPARENT.has(view) ? "transparent" : "window");
document.body.dataset.view = view;
// The default WebKit context menu (Reload / Inspect) never makes sense here.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (!t.closest("input, textarea, [contenteditable=true]")) e.preventDefault();
});
if (!isTauri && import.meta.env.DEV) {
  // Browser preview (dev only): minimal stand-ins for native commands.
  registerMock("image_info", () => [1400, 900, 1]);
  registerMock("export_dir", () => "/Users/me/Desktop");
  const storageDefault = "/Users/me/Library/Application Support/Screenshot X";
  let storage = storageDefault;
  registerMock("storage_info", () => ({ current: storage, default: storageDefault }));
  registerMock("set_storage_location", (a) => {
    storage = a.path || storageDefault;
    return { current: storage, default: storageDefault };
  });
  registerMock("new_file_stem", () => "Screenshot X 2026-01-01 at 10.00.00");
  const mode = params.get("mode") ?? "area";
  registerMock("overlay_payload", () => ({
    sessionId: 1,
    mode,
    display: { id: 1, index: 1, x: 0, y: 0, width: window.innerWidth, height: window.innerHeight, scale: 2, isMain: true },
    imageUrl: "/dev/sample.png",
    windows: [
      { id: 10, pid: 1, owner: "Safari", title: "Apple", layer: 0, x: 120, y: 80, width: 520, height: 360 },
      { id: 11, pid: 2, owner: "Notes", title: "Ideas", layer: 0, x: 420, y: 260, width: 400, height: 260 },
    ],
    mouse: [300, 200],
    crosshair: "always",
    magnifier: true,
    freeze: true,
    preset: null,
    // ?remember=1: reopen on a remembered area (All-In-One)
    remember: params.get("remember") ? { displayId: 1, x: 160, y: 120, w: 360, h: 220 } : null,
    recordKind: "video",
    settings: { recShowCursor: true, recRecordMicrophone: true },
    accent: "#0a84ff",
  }));
  registerMock("overlay_cancel", () => {
    (window as any).__cancels = ((window as any).__cancels ?? 0) + 1;
  });
  registerMock("overlay_commit", (a) => {
    (window as any).__lastCommit = a.commit;
    console.info("commit", JSON.stringify(a.commit));
  });
  registerMock("video_info", () => ({ duration: 4.2, width: 640, height: 400, size: 40667 }));
  registerMock("video_filmstrip", () => []);
  registerMock("media_devices", () => ({ microphones: [{ id: "m1", name: "MacBook Pro Microphone" }], cameras: [{ id: "c1", name: "FaceTime HD Camera" }] }));
}
initSettings();
window.addEventListener("error", (e) => invoke("js_log", { level: "error", msg: `${e.message} @ ${e.filename}:${e.lineno}` }));
window.addEventListener("unhandledrejection", (e) => invoke("js_log", { level: "error", msg: `unhandled: ${String(e.reason)}` }));

const View = views[view] ?? views.prefs;
createRoot(document.getElementById("root")!).render(
  <Suspense fallback={null}>
    <View />
  </Suspense>,
);
