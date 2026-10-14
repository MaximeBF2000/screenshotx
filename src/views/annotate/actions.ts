import { save as saveDialog, message } from "@tauri-apps/plugin-dialog";
import { startDrag } from "@crabnebula/tauri-plugin-drag";
import { basename, closeSelf, invoke, savePng, writeFileBytes } from "../../lib/ipc";
import { useSettings } from "../../lib/settings";
import { computeBalance, exportObjectPng, exportPng, type Env } from "./render";
import { flattenCanvas, selectionBounds, useAnnotate } from "./store";
import type { Doc } from "./types";

export interface Source {
  path: string;
  captureId: string;
  /** opened from an existing file (not a fresh capture) */
  external: boolean;
  project: boolean;
}

export const source: Source = { path: "", captureId: "", external: false, project: false };

function env(): Env {
  const st = useAnnotate.getState();
  const s = useSettings.getState().settings;
  const doc = st.doc!;
  const base = st.images.get(doc.base);
  return {
    images: st.images,
    drawShadows: s?.annotateDrawShadow ?? true,
    balance: doc.background.enabled && (doc.background.autoBalance || doc.background.inset > 0) && base ? computeBalance(base, doc) : null,
  };
}

export async function renderBytes(): Promise<Uint8Array> {
  const doc = useAnnotate.getState().doc!;
  return exportPng(doc, env(), doc.scale);
}

/** Render to a temporary file (for drag, share, pin, print, copy). */
export async function renderTemp(dir: "temp" | "captures" = "temp"): Promise<string> {
  const doc = useAnnotate.getState().doc!;
  const stem = source.path ? basename(source.path).replace(/\.[^.]+$/, "") : await invoke<string>("new_file_stem");
  return savePng(await renderBytes(), { dir, stem, scale: doc.scale, format: "png" });
}

function stemOf(p: string) {
  return basename(p).replace(/\.[^.]+$/, "");
}

/** An image opened from disk (not a capture) is saved over its file. */
export function savesInPlace() {
  return source.external && !source.project && !source.captureId && !!source.path;
}

/**
 * ⌘S — overwrite an image opened from disk, or else hand the edit back to
 * Quick Access: the card shows the edited image and keeps the annotations,
 * so "Annotate" on the card reopens them editable.
 */
export async function save(opts: { close?: boolean; ask?: boolean } = {}) {
  const s = useSettings.getState().settings;
  const doc = useAnnotate.getState().doc!;
  const ask = opts.ask ?? s?.annotateSaveBehavior === "ask";
  if (ask) return saveAs();
  const path = savesInPlace() ? await savePng(await renderBytes(), { path: source.path, scale: doc.scale }) : await keepInQuickAccess();
  useAnnotate.setState({ dirty: false });
  if (opts.close !== false) {
    closeSelf();
  }
  return path;
}

/** Write the edited image and its project, then show them in Quick Access. */
async function keepInQuickAccess(): Promise<string> {
  const doc = useAnnotate.getState().doc!;
  const captureId = source.captureId || null;
  const stem = source.path ? stemOf(source.path) : await invoke<string>("new_file_stem");
  const [image, project] = await invoke<[string, string]>("annotate_edit_paths", { captureId, stem });
  await saveProject(project);
  const path = await savePng(await renderBytes(), { path: image, scale: doc.scale });
  // the next Save (with the window kept open) updates the same card
  source.captureId = (await invoke<string | null>("annotate_keep", { captureId, path, project })) ?? "";
  return path;
}

export async function saveAs() {
  const doc = useAnnotate.getState().doc!;
  const dir = await invoke<string>("export_dir");
  const stem = source.path ? stemOf(source.path) : await invoke<string>("new_file_stem");
  const p = await saveDialog({
    defaultPath: `${dir}/${stem}.png`,
    filters: [
      { name: "PNG Image", extensions: ["png"] },
      { name: "JPEG Image", extensions: ["jpg", "jpeg"] },
      { name: "HEIC Image", extensions: ["heic"] },
      { name: "WebP Image", extensions: ["webp"] },
      { name: "Screenshot X Project", extensions: ["screenshotx"] },
    ],
  });
  if (!p) return null;
  if (p.endsWith(".screenshotx")) {
    await saveProject(p);
  } else {
    const ext = p.split(".").pop()!.toLowerCase();
    await savePng(await renderBytes(), { path: p, format: ext, scale: doc.scale });
  }
  useAnnotate.setState({ dirty: false });
  return p;
}

/** Editable project: base image + annotations as JSON. */
export async function saveProject(path: string) {
  const st = useAnnotate.getState();
  const doc = st.doc!;
  const images: Record<string, string> = {};
  const keys = new Set<string>([doc.base, ...doc.objects.filter((o) => o.type === "image").map((o) => (o as any).src)]);
  if (doc.background.kind === "image") keys.add(doc.background.value);
  for (const k of keys) {
    const img = st.images.get(k);
    if (!img) continue;
    const c = document.createElement("canvas");
    c.width = (img as any).naturalWidth || img.width;
    c.height = (img as any).naturalHeight || img.height;
    c.getContext("2d")!.drawImage(img, 0, 0);
    images[k] = c.toDataURL("image/png");
  }
  const json = JSON.stringify({ app: "Screenshot X", version: 1, doc, images });
  await writeFileBytes(path, new TextEncoder().encode(json));
}

export async function copy() {
  const s = useSettings.getState().settings;
  const p = await renderTemp("temp");
  await invoke("copy_file_to_clipboard", { path: p });
  if (s?.annotateCopyAndClose) closeSelf();
}

export async function copySelectedObject() {
  const st = useAnnotate.getState();
  const doc = st.doc!;
  const b = selectionBounds(doc, st.selected);
  if (!b) return copy();
  st.copySelection();
  const o = doc.objects.find((x) => x.id === st.selected[0])!;
  const bytes = await exportObjectPng(doc, env(), o, b);
  const p = await savePng(bytes, { dir: "temp", stem: "Annotation", scale: doc.scale });
  await invoke("copy_file_to_clipboard", { path: p });
}

export async function dragOut(thumb?: string) {
  const p = await renderTemp("temp");
  await startDrag({ item: [p], icon: thumb ?? p, mode: "copy" });
}

export async function share(x: number, y: number) {
  const p = await renderTemp("temp");
  await invoke("share_files", { paths: [p], x, y });
}

export async function pin() {
  const p = await renderTemp("captures");
  await invoke("pin_open", { path: p });
}

export async function print() {
  const p = await renderTemp("temp");
  await invoke("print_image", { path: p });
}

export async function toQuickAccess() {
  const p = await renderTemp("captures");
  await invoke("add_to_quick_access", { path: p });
}

/** Ask about unsaved changes. Returns true if the window may close. */
export async function confirmClose(): Promise<boolean> {
  const st = useAnnotate.getState();
  if (!st.dirty || !st.doc?.objects.length) return true;
  const r = await message("Do you want to save the changes you made to the screenshot?\n\nYour changes will be lost if you don't save them.", {
    title: "Unsaved changes",
    kind: "warning",
    buttons: { yes: "Save", no: "Don't Save", cancel: "Cancel" },
  });
  if (r === "Yes" || r === "Save") {
    await save({ close: false });
    return true;
  }
  return r === "No" || r === "Don't Save";
}

export function flatDocCanvas(doc: Doc) {
  return flattenCanvas(doc, useAnnotate.getState().images);
}
