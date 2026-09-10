// Scene model shared by the server, the control panel and the stage. The
// stage renders exactly this; the control panel edits it; the server owns
// it (persists, freezes while live, resolves model/background URLs).

/** Canvas-space camera for the avatar: x/y = centre point, zoom = scale. */
export interface AvatarTransform {
  x: number;
  y: number;
  zoom: number;
  locked: boolean;
}

export type BackgroundKind = "transparent" | "color" | "image";

/** Background transform uses viewport pixels: x/y = offset of the image
 *  centre from the viewport centre, zoom = multiplier over "fit" size. */
export interface SceneBackground {
  kind: BackgroundKind;
  color: string;
  imageId: string | null;
  imageUrl: string | null;
  x: number;
  y: number;
  zoom: number;
  locked: boolean;
}

export interface Scene {
  live: boolean;
  modelId: string | null;
  modelUrl: string | null;
  modelName: string | null;
  avatar: AvatarTransform;
  background: SceneBackground;
}

export interface ModelInfo {
  id: string;
  name: string;
  url: string;
  uploadedAt: number;
}

export interface BackgroundInfo {
  id: string;
  name: string;
  url: string;
  uploadedAt: number;
}

export type TrackingStatus =
  | "connecting"
  | "connected"
  | "stalled"
  | "disconnected";

/** One-click chroma preset for non-OBS capture paths. */
export const CHROMA_GREEN = "#00B140";

/** Avatar zoom 0 is the "not positioned yet" sentinel; consumers fit the
 *  model to the viewport until the control panel commits a real transform. */
export function defaultScene(): Scene {
  return {
    live: false,
    modelId: null,
    modelUrl: null,
    modelName: null,
    avatar: { x: 0, y: 0, zoom: 0, locked: false },
    background: {
      kind: "transparent",
      color: CHROMA_GREEN,
      imageId: null,
      imageUrl: null,
      x: 0,
      y: 0,
      zoom: 0,
      locked: false,
    },
  };
}
