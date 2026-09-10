// Background rendering lives OUTSIDE the WebGL canvas (a DOM layer + 2D
// canvas behind the avatar), so @oar/renderer stays untouched. Transparent is
// the documented default for OBS: the page background shows through and the
// browser source keeps alpha.

import type { SceneBackground } from "@oar/shared";

export class BackgroundRenderer {
  private image: ImageBitmap | null = null;
  private imageUrl: string | null = null;
  private loadToken = 0;

  constructor(
    private layer: HTMLElement,
    private canvas: HTMLCanvasElement | null,
  ) {}

  async setImage(url: string | null): Promise<void> {
    if (url === this.imageUrl) return;
    this.imageUrl = url;
    this.image?.close();
    this.image = null;
    if (!url || !this.canvas) return;
    const token = ++this.loadToken;
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`fetch ${url}: HTTP ${res.status}`);
      const blob = await res.blob();
      if (token !== this.loadToken) return;
      this.image = await createImageBitmap(blob);
    } catch (e) {
      console.error("[player] background load failed:", e);
      if (token === this.loadToken) this.image = null;
    }
  }

  /** Reset the layer to transparent and clear the canvas. */
  clear(): void {
    this.layer.style.background = "transparent";
    const ctx = this.canvas?.getContext("2d");
    if (ctx && this.canvas) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  draw(bg: SceneBackground, vw: number, vh: number): void {
    this.layer.style.background =
      bg.kind === "color" ? bg.color : "transparent";
    const ctx = this.canvas?.getContext("2d");
    if (!ctx || !this.canvas) return;
    const dpr = window.devicePixelRatio || 1;
    if (this.canvas.width !== Math.round(vw * dpr) || this.canvas.height !== Math.round(vh * dpr)) {
      this.canvas.width = Math.round(vw * dpr);
      this.canvas.height = Math.round(vh * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, vw, vh);
    if (bg.kind !== "image" || !this.image) return;
    const img = this.image;
    const fit = Math.min(vw / img.width, vh / img.height);
    const zoom = Number.isFinite(bg.zoom) && bg.zoom > 1e-4 ? bg.zoom : 1;
    const scale = fit * zoom;
    const cx = vw / 2 + (Number.isFinite(bg.x) ? bg.x : 0);
    const cy = vh / 2 + (Number.isFinite(bg.y) ? bg.y : 0);
    ctx.drawImage(
      img,
      cx - (img.width * scale) / 2,
      cy - (img.height * scale) / 2,
      img.width * scale,
      img.height * scale,
    );
  }
}
