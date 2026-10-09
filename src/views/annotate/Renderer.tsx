import { useEffect } from "react";
import { invoke, params } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { computeBalance, exportPng } from "./render";
import { imgSize, loadBitmap } from "./images";
import { DEFAULT_BACKGROUND, type BgPreset, type Doc } from "./types";
import type { ImgSrc } from "./render";

/** Hidden window: applies a Background Tool preset to a fresh capture. */
export default function Renderer() {
  const settings = useSettings((s) => s.settings);
  useEffect(() => {
    if (!settings) return;
    const path = params.get("path")!;
    const itemId = params.get("itemId")!;
    const presetId = params.get("presetId")!;
    const done = (bytes?: Uint8Array) => invoke("renderer_done", bytes ?? new Uint8Array(), { headers: { item: itemId } });
    (async () => {
      try {
        const preset: BgPreset | undefined = (settings.backgroundPresets ?? []).find((p: BgPreset) => p.id === presetId);
        if (!preset) return done();
        const images = new Map<string, ImgSrc>();
        const base = await loadBitmap(path);
        images.set("base", base);
        const info = await invoke<[number, number, number]>("image_info", { path }).catch(() => null);
        const scale = info?.[2] ?? 1;
        const { w, h } = imgSize(base);
        const { id: _i, name: _n, ...rest } = preset;
        void _i;
        void _n;
        const doc: Doc = {
          base: "base",
          baseW: w / scale,
          baseH: h / scale,
          scale,
          canvas: { x: 0, y: 0, w: w / scale, h: h / scale },
          objects: [],
          background: { ...DEFAULT_BACKGROUND, ...rest, enabled: true },
        };
        if (doc.background.kind === "wallpaper" || doc.background.kind === "blurredWallpaper") {
          const p = await invoke<string | null>("wallpaper_path", { blurred: doc.background.kind === "blurredWallpaper" });
          if (p) images.set(doc.background.kind, await loadBitmap(p));
        } else if (doc.background.kind === "image") {
          images.set(doc.background.value, await loadBitmap(doc.background.value));
        }
        const balance = doc.background.autoBalance || doc.background.inset > 0 ? computeBalance(base, doc) : null;
        done(await exportPng(doc, { images, drawShadows: true, balance }, scale));
      } catch (e) {
        invoke("js_log", { level: "error", msg: `renderer failed: ${e}` });
        done();
      }
    })();
  }, [settings]);
  return null;
}
