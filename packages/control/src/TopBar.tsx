import type { RefObject } from "react";
import {
  CHROMA_GREEN,
  type BackgroundInfo,
  type ModelInfo,
  type Scene,
  type TrackingStatus,
} from "@oar/shared";
import type { Player } from "@oar/player";

interface TopBarProps {
  playerRef: RefObject<Player | null>;
  scene: Scene | null;
  models: ModelInfo[];
  backgrounds: BackgroundInfo[];
  connected: boolean;
  tracking: TrackingStatus;
}

async function upload(kind: "model" | "background", file: File): Promise<void> {
  const url = `/api/uploads?kind=${kind}&name=${encodeURIComponent(file.name)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: file,
  });
  if (!res.ok) throw new Error(`upload failed: HTTP ${res.status}`);
}

export function TopBar({
  playerRef,
  scene,
  models,
  backgrounds,
  connected,
  tracking,
}: TopBarProps) {
  const player = () => playerRef.current;

  const onModel = (e: React.ChangeEvent<HTMLSelectElement>) => {
    player()?.patchScene({ modelId: e.target.value || null });
  };

  const onBackground = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const v = e.target.value;
    if (v === "transparent") {
      player()?.patchScene({ background: { kind: "transparent" } });
    } else if (v === "chroma") {
      player()?.patchScene({ background: { kind: "color", color: CHROMA_GREEN } });
    } else {
      player()?.patchScene({ background: { kind: "image", imageId: v } });
    }
  };

  const toggleLive = () => {
    const p = player();
    if (p) p.setLive(!p.scene.live);
  };

  const toggleLock = () => {
    const p = player();
    if (p) p.setAvatarLocked(!p.scene.avatar.locked);
  };

  const onFile = async (
    kind: "model" | "background",
    e: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      await upload(kind, file);
    } catch (err) {
      console.error("[control] upload failed:", err);
    }
  };

  const bgValue = scene
    ? scene.background.kind === "image"
      ? (scene.background.imageId ?? "")
      : scene.background.kind === "color"
        ? "chroma"
        : "transparent"
    : "transparent";

  const stageUrl = `${location.protocol}//${location.hostname}:3003/`;

  return (
    <header className="topbar">
      <span className="brand">open-avatar studio</span>

      <label className="field">
        <span>Model</span>
        <select value={scene?.modelId ?? ""} onChange={onModel} disabled={!models.length}>
          <option value="">— none —</option>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span>Background</span>
        <select value={bgValue} onChange={onBackground}>
          <option value="transparent">Transparent (OBS)</option>
          <option value="chroma">Chroma green</option>
          {backgrounds.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <button
        className={scene?.live ? "live on" : "live"}
        onClick={toggleLive}
        disabled={!scene}
      >
        {scene?.live ? "End Live" : "Go Live"}
      </button>

      <label className="toggle">
        <input
          type="checkbox"
          checked={scene?.avatar.locked ?? false}
          onChange={toggleLock}
        />
        Lock position
      </label>

      <button onClick={() => player()?.resetAvatar()} disabled={!scene}>
        Reset view
      </button>

      <span className="spacer" />

      <label className="upload">
        Add model
        <input
          type="file"
          accept=".oar"
          hidden
          onChange={(e) => void onFile("model", e)}
        />
      </label>
      <label className="upload">
        Add background
        <input
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.gif"
          hidden
          onChange={(e) => void onFile("background", e)}
        />
      </label>

      <span className={`dot ${connected ? "on" : ""}`} title={connected ? "server connected" : "server offline"} />
      <span className={`tracking ${tracking}`} title={`tracking: ${tracking}`}>
        {tracking}
      </span>

      <span className="stage-url" title="Paste this into OBS as a browser source">
        OBS source: <code>{stageUrl}</code>
      </span>
    </header>
  );
}
