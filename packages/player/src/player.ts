// Player: owns the WebSocket connection to the studio server, the scene
// state (received from the server — never shared client state), the tracking
// stream, and the 60fps render loop. Used identically by the stage (render
// only, idle until live) and the control panel (preview + edit + Go Live).

import {
  defaultScene,
  parseServerMessage,
  type AvatarTransform,
  type BackgroundInfo,
  type ClientMessage,
  type ModelInfo,
  type Scene,
  type ScenePatch,
  type ServerMessage,
  type TrackingStatus,
} from "@oar/shared";
import { rigParam } from "@oar/core";
import { PlayerEngine } from "./engine";
import { loadModelByUrl, type LoadedModel } from "./load";
import { BackgroundRenderer } from "./background";

export interface PlayerOptions {
  role: "stage" | "control";
  wsUrl: string;
  avatarCanvas: HTMLCanvasElement;
  backgroundLayer: HTMLElement;
  backgroundCanvas: HTMLCanvasElement | null;
  /** false for the stage: blank until Go Live. true for the control preview. */
  renderWhenIdle: boolean;
  onScene?: (scene: Scene) => void;
  onTrackingStatus?: (status: TrackingStatus) => void;
  onModels?: (models: ModelInfo[]) => void;
  onBackgrounds?: (backgrounds: BackgroundInfo[]) => void;
  onConnection?: (connected: boolean) => void;
  onModelLoaded?: (model: LoadedModel) => void;
}

const RECONNECT_MS = 2000;

export class Player {
  scene: Scene = defaultScene();
  models: ModelInfo[] = [];
  backgrounds: BackgroundInfo[] = [];
  trackingStatus: TrackingStatus = "disconnected";
  wsConnected = false;

  readonly engine: PlayerEngine;
  private background: BackgroundRenderer;
  private ws: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private model: LoadedModel | null = null;
  private modelToken = 0;
  private raf = 0;
  private lastTime = 0;

  constructor(private opts: PlayerOptions) {
    this.engine = new PlayerEngine(opts.avatarCanvas);
    this.background = new BackgroundRenderer(
      opts.backgroundLayer,
      opts.backgroundCanvas,
    );
  }

  connect(): void {
    this.stopped = false;
    this.lastTime = performance.now();
    this.raf = requestAnimationFrame(this.loop);
    this.connectOnce();
  }

  disconnect(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.setConnected(false);
  }

  // ------------------------------------------------------------ ws client

  private connectOnce(): void {
    if (this.stopped) return;
    try {
      this.ws = new WebSocket(this.opts.wsUrl);
    } catch {
      this.scheduleReconnect();
      return;
    }
    this.ws.onopen = () => this.setConnected(true);
    this.ws.onclose = () => {
      this.setConnected(false);
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {};
    this.ws.onmessage = (ev) => this.handle(ev.data as string);
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectOnce();
    }, RECONNECT_MS);
  }

  private setConnected(connected: boolean): void {
    if (this.wsConnected === connected) return;
    this.wsConnected = connected;
    this.opts.onConnection?.(connected);
  }

  send(msg: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  /** Control panel only. The stage never sends patches. */
  patchScene(patch: ScenePatch): void {
    this.send({ type: "scene.patch", patch });
  }

  setLive(live: boolean): void {
    this.send({ type: "scene.live", live });
  }

  /** Effective transform for editing: the committed scene value, or the fit
   *  fallback until the control panel commits a real one (zoom 0 sentinel). */
  effectiveAvatar(): AvatarTransform {
    const a = this.scene.avatar;
    if (Number.isFinite(a.zoom) && a.zoom > 1e-4) return a;
    const vw = this.opts.avatarCanvas.clientWidth || window.innerWidth;
    const vh = this.opts.avatarCanvas.clientHeight || window.innerHeight;
    const cam = this.avatarCamera(vw, vh);
    return { x: cam.x, y: cam.y, zoom: cam.zoom, locked: a.locked };
  }

  /** Control panel only: commit a transform immediately (smooth local update
   *  plus a scene patch; the server echo reconciles). */
  setAvatar(av: AvatarTransform): void {
    this.scene.avatar = av;
    this.patchScene({ avatar: { x: av.x, y: av.y, zoom: av.zoom } });
  }

  /** Control panel only: drop the transform back to the fit sentinel. */
  resetAvatar(): void {
    const a = this.scene.avatar;
    this.scene.avatar = { ...a, x: 0, y: 0, zoom: 0 };
    this.patchScene({ avatar: { x: 0, y: 0, zoom: 0 } });
  }

  /** Control panel only: pin the transform so gestures are ignored. */
  setAvatarLocked(locked: boolean): void {
    this.scene.avatar = { ...this.scene.avatar, locked };
    this.patchScene({ avatar: { locked } });
  }

  // -------------------------------------------------------- receive path

  private handle(text: string): void {
    const msg = parseServerMessage(text);
    if (!msg) return;
    switch (msg.type) {
      case "scene.state":
        void this.applyScene(msg.scene);
        break;
      case "tracking.frame":
        this.handleTrackingFrame(msg);
        break;
      case "tracking.status":
        this.trackingStatus = msg.status;
        this.opts.onTrackingStatus?.(msg.status);
        break;
      case "model.list":
        this.models = msg.models;
        this.opts.onModels?.(msg.models);
        break;
      case "background.list":
        this.backgrounds = msg.backgrounds;
        this.opts.onBackgrounds?.(msg.backgrounds);
        break;
    }
  }

  /** Tracking → driver params. The server already applied the creator's blink
   *  floor, mouth gain and per-frame smoothing, so this just forwards the
   *  parsed frame. Last-known-good behaviour is structural: when frames stop,
   *  liveParams simply stop changing. */
  private handleTrackingFrame(msg: Extract<ServerMessage, { type: "tracking.frame" }>): void {
    const { params, blendshapes, present } = msg;
    if (Object.keys(params).length === 0 && !blendshapes) {
      if (!present) this.engine.updateBlendshapes(null);
      return;
    }
    this.engine.liveParams = { ...this.engine.liveParams, ...params };
    this.engine.updateBlendshapes(blendshapes);
  }

  private async applyScene(scene: Scene): Promise<void> {
    this.scene = scene;
    this.opts.onScene?.(scene);
    if (scene.background.kind === "image") {
      void this.background.setImage(scene.background.imageUrl);
    }
    const target = scene.modelId;
    if (!target) {
      this.modelToken++;
      this.model = null;
      this.send({ type: "tracking.config" });
      return;
    }
    if (this.model?.id === target) return;
    this.modelToken++;
    const token = this.modelToken;
    const info =
      this.models.find((m) => m.id === target) ??
      ({ id: target, name: scene.modelName ?? target, url: scene.modelUrl ?? "" } as const);
    if (!info.url) return;
    try {
      const loaded = await loadModelByUrl(info);
      if (token !== this.modelToken) return;
      this.model = loaded;
      this.engine.setModel(loaded);
      this.opts.onModelLoaded?.(loaded);
      // Report the model's rig tuning so the server parses tracking for it.
      this.send({
        type: "tracking.config",
        blinkFloor: rigParam(loaded.manifest.params, "blinkFloor"),
        mouthGain: rigParam(loaded.manifest.params, "mouthGain"),
      });
    } catch (e) {
      console.error("[player] model load failed:", e);
      if (token === this.modelToken) this.model = null;
    }
  }

  // --------------------------------------------------------- render loop

  private loop = (t: number): void => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.loop);
    const dtRaw = (t - this.lastTime) / 1000;
    this.lastTime = t;
    this.render(Math.min(0.05, Math.max(1e-4, dtRaw)));
  };

  private render(dt: number): void {
    const vw = this.opts.avatarCanvas.clientWidth || window.innerWidth;
    const vh = this.opts.avatarCanvas.clientHeight || window.innerHeight;
    // Solve every frame so Go Live has zero first-frame lag.
    this.engine.solve(dt);
    if (!this.scene.live && !this.opts.renderWhenIdle) {
      // Stage idle until Go Live: stay blank and transparent.
      this.background.clear();
      this.engine.clear();
      return;
    }
    this.background.draw(this.scene.background, vw, vh);
    this.engine.draw(this.avatarCamera(vw, vh));
  }

  /** Scene avatar transform; fall back to a fit view until the control panel
   *  commits a real transform (zoom 0 is the sentinel). */
  private avatarCamera(vw: number, vh: number) {
    const a = this.scene.avatar;
    const sane =
      Number.isFinite(a.x) &&
      Number.isFinite(a.y) &&
      Number.isFinite(a.zoom) &&
      a.zoom > 1e-4;
    if (sane) return { x: a.x, y: a.y, zoom: a.zoom };
    const m = this.engine.model;
    if (m) {
      return {
        x: m.canvas.width / 2,
        y: m.canvas.height / 2,
        zoom: Math.min(vw / (m.canvas.width * 1.15), vh / (m.canvas.height * 1.15)),
      };
    }
    return { x: 0, y: 0, zoom: 1 };
  }
}
