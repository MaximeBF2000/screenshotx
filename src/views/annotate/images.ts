import { readFileBytes } from "../../lib/ipc";
import type { ImgSrc } from "./render";

/** Decode a local file into an ImageBitmap (same-origin → canvas stays untainted). */
export async function loadBitmap(path: string): Promise<ImgSrc> {
  const buf = await readFileBytes(path);
  const blob = new Blob([buf]);
  try {
    return await createImageBitmap(blob);
  } catch {
    // formats createImageBitmap can't decode (HEIC...) → let WebKit try via <img>
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  }
}

export async function loadBytes(bytes: ArrayBuffer | Uint8Array): Promise<ImgSrc> {
  return createImageBitmap(new Blob([bytes as BlobPart]));
}

export async function loadDataUrl(url: string): Promise<ImgSrc> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export function imgSize(img: ImgSrc): { w: number; h: number } {
  return { w: (img as HTMLImageElement).naturalWidth || img.width, h: (img as HTMLImageElement).naturalHeight || img.height };
}
