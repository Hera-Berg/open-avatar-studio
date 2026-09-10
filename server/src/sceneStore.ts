// Scene store: the single source of truth for what the stage renders. The
// server owns it — persists it to data/scene.json, resolves model/background
// URLs from the uploaded file lists, and re-broadcasts after every change.
//
// Edits apply live (that is the point of a vtuber control panel); the stage
// itself stays blank until Go Live.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultScene,
  type BackgroundInfo,
  type ModelInfo,
  type Scene,
  type ScenePatch,
} from "@oar/shared";

export class SceneStore {
  private scene: Scene = defaultScene();
  private modelList: ModelInfo[] = [];
  private backgroundList: BackgroundInfo[] = [];
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.scene = this.load();
  }

  get value(): Scene {
    return this.scene;
  }

  get models(): ModelInfo[] {
    return this.modelList;
  }

  get backgrounds(): BackgroundInfo[] {
    return this.backgroundList;
  }

  setModels(models: ModelInfo[]): void {
    this.modelList = models;
  }

  setBackgrounds(backgrounds: BackgroundInfo[]): void {
    this.backgroundList = backgrounds;
  }

  /** Apply one client message and return the updated scene. */
  apply(msg: { type: "scene.live"; live: boolean } | { type: "scene.patch"; patch: ScenePatch }): Scene {
    if (msg.type === "scene.live") {
      this.scene.live = msg.live;
    } else {
      this.patch(msg.patch);
    }
    this.persistSoon();
    return this.scene;
  }

  private patch(p: ScenePatch): void {
    const s = this.scene;
    if (p.modelId !== undefined) {
      s.modelId = p.modelId;
      const info = p.modelId ? this.modelList.find((m) => m.id === p.modelId) : null;
      s.modelUrl = info?.url ?? null;
      s.modelName = info?.name ?? null;
    }
    if (p.avatar) {
      s.avatar = { ...s.avatar, ...p.avatar };
    }
    if (p.background) {
      const b = { ...s.background, ...p.background };
      if (b.kind === "image") {
        const info =
          this.backgroundList.find((x) => x.id === b.imageId) ??
          this.backgroundList[0] ??
          null;
        b.imageId = info?.id ?? null;
        b.imageUrl = info?.url ?? null;
        if (!b.imageId) b.kind = "transparent";
      } else {
        b.imageId = null;
        b.imageUrl = null;
      }
      s.background = b;
    }
  }

  /** Drop references to a removed model/background and re-broadcast. */
  reconcile(): Scene {
    const s = this.scene;
    if (s.modelId && !this.modelList.some((m) => m.id === s.modelId)) {
      s.modelId = null;
      s.modelUrl = null;
      s.modelName = null;
    }
    if (s.background.kind === "image" && s.background.imageId) {
      if (!this.backgroundList.some((b) => b.id === s.background.imageId)) {
        s.background = {
          ...s.background,
          kind: "transparent",
          imageId: null,
          imageUrl: null,
        };
      }
    }
    this.persistSoon();
    return s;
  }

  private load(): Scene {
    try {
      const raw = readFileSync(join(this.dataDir, "scene.json"), "utf8");
      const parsed = JSON.parse(raw) as Partial<Scene>;
      return { ...defaultScene(), ...parsed };
    } catch {
      return defaultScene();
    }
  }

  private persistSoon(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        writeFileSync(
          join(this.dataDir, "scene.json"),
          JSON.stringify(this.scene, null, 2),
        );
      } catch (e) {
        console.error("[server] scene persist failed:", e);
      }
    }, 200);
  }
}
