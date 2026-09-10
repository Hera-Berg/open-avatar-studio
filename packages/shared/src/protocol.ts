// WebSocket protocol between the studio server and its clients.
//
// The stage and control panel are separate browser instances with no shared
// client state — everything the stage needs arrives over this socket or
// over HTTP from the server. The server is the only tracker reader: it runs
// the creator's TrackerClient (parse + smooth) and broadcasts already-parsed
// `tracking.frame` messages. Per-model rig tuning (blinkFloor/mouthGain) is
// reported by clients with `tracking.config` when they load a model.

import type {
  Scene,
  ModelInfo,
  BackgroundInfo,
  TrackingStatus,
  SceneBackground,
  AvatarTransform,
} from "./scene";

export type Role = "stage" | "control";

export type ServerMessage =
  | { type: "scene.state"; scene: Scene }
  | { type: "tracking.status"; status: TrackingStatus }
  | { type: "model.list"; models: ModelInfo[] }
  | { type: "background.list"; backgrounds: BackgroundInfo[] }
  // Parsed by the server (TrackerClient: blink floor, mouth gain, smoothing).
  | {
      type: "tracking.frame";
      params: Record<string, number>;
      blendshapes: Record<string, number> | null;
      present: boolean;
    };

export interface ScenePatch {
  modelId?: string | null;
  avatar?: Partial<AvatarTransform>;
  background?: Partial<SceneBackground>;
}

export type ClientMessage =
  | { type: "scene.patch"; patch: ScenePatch }
  | { type: "scene.live"; live: boolean }
  // Rig tuning of the currently loaded model; omit a key to use defaults.
  | { type: "tracking.config"; blinkFloor?: number; mouthGain?: number };

const SERVER_TYPES = new Set([
  "scene.state",
  "tracking.status",
  "model.list",
  "background.list",
  "tracking.frame",
]);

const CLIENT_TYPES = new Set(["scene.patch", "scene.live", "tracking.config"]);

function asRecord(text: string): Record<string, unknown> | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof json !== "object" || json === null) return null;
  return json as Record<string, unknown>;
}

/** Parse a server→client message. Returns null for anything unrecognised
 *  (the stage must ignore unknown messages, never crash on them). */
export function parseServerMessage(text: string): ServerMessage | null {
  const msg = asRecord(text);
  if (!msg || typeof msg.type !== "string" || !SERVER_TYPES.has(msg.type)) {
    return null;
  }
  return msg as unknown as ServerMessage;
}

/** Parse a client→server message. Returns null for anything unrecognised. */
export function parseClientMessage(text: string): ClientMessage | null {
  const msg = asRecord(text);
  if (!msg || typeof msg.type !== "string" || !CLIENT_TYPES.has(msg.type)) {
    return null;
  }
  return msg as unknown as ClientMessage;
}
