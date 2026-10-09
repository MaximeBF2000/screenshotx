import { useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke, listenHere, params } from "../../lib/ipc";

const shape = params.get("shape") ?? "circle";
const flip = params.get("flip") !== "false";
const deviceId = params.get("device") ?? "";

/** Webcam bubble, included in the recording. Drag to move, click to toggle full screen. */
export default function Camera() {
  const video = useRef<HTMLVideoElement>(null);
  const [full, setFull] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const down = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    (async () => {
      try {
        let constraints: MediaStreamConstraints = { video: { width: 1280, height: 720 }, audio: false };
        if (deviceId) {
          const devs = await invoke<{ cameras: { id: string; name: string }[] }>("media_devices");
          const name = devs?.cameras.find((c) => c.id === deviceId)?.name;
          // labels are only available after a first permission grant
          const tmp = await navigator.mediaDevices.getUserMedia({ video: true });
          tmp.getTracks().forEach((t) => t.stop());
          const list = await navigator.mediaDevices.enumerateDevices();
          const match = list.find((d) => d.kind === "videoinput" && d.label === name);
          if (match) constraints = { video: { deviceId: { exact: match.deviceId }, width: 1280, height: 720 }, audio: false };
        }
        stream = await navigator.mediaDevices.getUserMedia(constraints);
        if (video.current) video.current.srcObject = stream;
      } catch (e) {
        setError("Screenshot X does not have access to the camera.");
        invoke("js_log", { level: "error", msg: `camera: ${e}` });
      }
    })();
    const un = listenHere("camera:toggle-fullscreen", () => toggle());
    return () => {
      stream?.getTracks().forEach((t) => t.stop());
      un.then((f) => f());
    };
  }, []);

  const toggle = () =>
    setFull((f) => {
      invoke("camera_fullscreen", { on: !f });
      return !f;
    });

  const radius = full ? 0 : shape === "circle" ? "50%" : shape === "roundedRect" ? 22 : 10;
  return (
    <div
      className="w-full h-full p-1"
      onMouseDown={(e) => {
        down.current = { x: e.screenX, y: e.screenY };
        if (!full) getCurrentWebviewWindow().startDragging();
      }}
      onMouseUp={async (e) => {
        const d = down.current;
        down.current = null;
        if (d && Math.hypot(e.screenX - d.x, e.screenY - d.y) < 4) toggle();
        else if (!full) {
          const f = await invoke<[number, number, number, number]>("window_frame");
          if (f) invoke("camera_save_position", { x: f[0], y: f[1] });
        }
      }}
    >
      <div className="w-full h-full overflow-hidden bg-black relative" style={{ borderRadius: radius, boxShadow: full ? undefined : "0 8px 30px rgba(0,0,0,0.45), 0 0 0 2px rgba(255,255,255,0.85)" }}>
        <video ref={video} autoPlay muted playsInline className="w-full h-full object-cover" style={{ transform: flip ? "scaleX(-1)" : undefined }} />
        {error && <div className="absolute inset-0 flex items-center justify-center text-white text-[11px] text-center p-3">{error}</div>}
      </div>
    </div>
  );
}
