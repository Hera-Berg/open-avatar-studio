// Load a .oar by URL: fetch the zip from the studio server, unpack it with
// @oar/core's readOar, and decode every layer PNG to a PixelImage for the
// WebGL textures. Never touches a File input or a blob URL — the stage is a
// different browser and can only see server URLs.

import { readOar, type OarManifest, type PixelImage } from "@oar/core";

export interface LoadedModel {
  id: string;
  name: string;
  url: string;
  manifest: OarManifest;
  pixels: Map<string, PixelImage>;
  thumbnail: Uint8Array | null;
}

/** Decode PNG bytes to straight-alpha RGBA pixels (mirrors the creator's
 *  helper — DOM-only glue, the only part not worth importing). */
export async function decodePng(bytes: Uint8Array): Promise<PixelImage> {
  const blob = new Blob([bytes as BlobPart], { type: "image/png" });
  const bitmap = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);
  const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close();
  return { width: data.width, height: data.height, data: data.data };
}

export interface ModelSource {
  id: string;
  name: string;
  url: string;
}

export async function loadModelByUrl(info: ModelSource): Promise<LoadedModel> {
  const res = await fetch(info.url);
  if (!res.ok) throw new Error(`fetch ${info.url}: HTTP ${res.status}`);
  const buffer = await res.arrayBuffer();
  const pkg = readOar(new Uint8Array(buffer));
  const pixels = new Map<string, PixelImage>();
  for (const [id, bytes] of pkg.pngs) {
    pixels.set(id, await decodePng(bytes));
  }
  return {
    id: info.id,
    name: info.name,
    url: info.url,
    manifest: pkg.manifest,
    pixels,
    thumbnail: pkg.thumbnail,
  };
}
