// Playback engine: the 60fps solve loop (tracking/demo/manual params →
// solveModel → WebGL draw). A store-free mirror of the creator's
// playback/engine.ts — the evaluator and renderer are shared, only the glue
// differs (no zustand, the scene drives the camera here).

import { Renderer, type CameraState } from "@oar/renderer";
import {
  createSolveContext,
  deriveLashLowerEdge,
  solveModel,
  withDriverDefaults,
  type DriverParam,
  type OarManifest,
  type PixelImage,
  type SolvedModel,
} from "@oar/core";
import type { LoadedModel } from "./load";

export class PlayerEngine {
  readonly renderer: Renderer;
  private solveCtx = createSolveContext();
  private loaded: LoadedModel | null = null;
  /** live driver params from the tracker (last-known-good by construction:
   *  when frames stop, this holds the last pose) */
  liveParams: Partial<Record<DriverParam, number>> = {};
  /** manual params — only the control panel sets these */
  manual: Partial<Record<DriverParam, number>> = {};
  private current: SolvedModel | null = null;
  params: Record<DriverParam, number> = withDriverDefaults({});

  constructor(private canvas: HTMLCanvasElement) {
    this.renderer = new Renderer(canvas);
  }

  get model(): OarManifest | null {
    return this.loaded?.manifest ?? null;
  }

  setModel(model: LoadedModel): void {
    this.loaded = model;
    for (const [id, img] of model.pixels) {
      this.renderer.setTexture(
        id,
        new ImageData(new Uint8ClampedArray(img.data), img.width, img.height),
      );
    }
    // Fresh solve context: new model = new mesh cache, physics, eye runtime.
    this.solveCtx = createSolveContext();
    this.solveCtx.meshes = new Map(model.manifest.meshes.map((m) => [m.id, m]));
    this.refreshEyeRuntime(model);
    this.current = null;
  }

  updateBlendshapes(blendshapes: Record<string, number> | null): void {
    this.solveCtx.blendshapes = blendshapes;
  }

  /** Solve the current frame. Runs every tick regardless of live state so a
   *  Go Live flip has zero first-frame lag. */
  solve(dt: number): void {
    const model = this.loaded;
    if (!model) {
      this.current = null;
      return;
    }
    this.solveCtx.dt = dt;
    const params = withDriverDefaults({ ...this.liveParams, ...this.manual });
    this.current = solveModel(model.manifest, params, this.solveCtx);
    this.params = params;
  }

  draw(camera: CameraState): void {
    if (!this.current) return;
    // Transparent clear so the stage stays alpha-clean for OBS.
    this.renderer.draw(this.current, camera, [0, 0, 0, 0]);
  }

  clear(): void {
    this.renderer.clear(0, 0, 0, 0);
  }

  private eyeRuntimeModel: OarManifest | null = null;

  private refreshEyeRuntime(model: LoadedModel): void {
    if (this.eyeRuntimeModel === model.manifest) return;
    this.eyeRuntimeModel = model.manifest;
    for (const side of ["left", "right"] as const) {
      const eye = model.manifest.rig?.eyes[side];
      const lashId = eye?.lashTop;
      if (!lashId) {
        this.solveCtx.eyeRuntime[side].lashLower = null;
        continue;
      }
      const layer = model.manifest.layers.find((l) => l.id === lashId);
      const img = layer ? model.pixels.get(lashId) : undefined;
      this.solveCtx.eyeRuntime[side].lashLower =
        layer && img ? deriveLashLowerEdge(img, layer.x, layer.y) : null;
    }
  }
}
