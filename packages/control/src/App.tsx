// Control panel: the interactive editor. A single Player renders the preview
// (idle = always visible here, unlike the stage) and talks to the server over
// the same socket the stage uses — the panel never holds privileged state, it
// just edits the server-owned scene.

import { useEffect, useRef, useState } from "react";
import type {
  BackgroundInfo,
  ModelInfo,
  Scene,
  TrackingStatus,
} from "@oar/shared";
import { Player } from "@oar/player";
import { TopBar } from "./TopBar";
import { Viewport } from "./Viewport";

export function App() {
  const viewportRef = useRef<HTMLCanvasElement>(null);
  const bgLayerRef = useRef<HTMLDivElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const playerRef = useRef<Player | null>(null);

  const [scene, setScene] = useState<Scene | null>(null);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [backgrounds, setBackgrounds] = useState<BackgroundInfo[]>([]);
  const [tracking, setTracking] = useState<TrackingStatus>("disconnected");
  const [connected, setConnected] = useState(false);
  const [modelName, setModelName] = useState<string | null>(null);

  useEffect(() => {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const player = new Player({
      role: "control",
      wsUrl: `${protocol}//${location.host}/ws`,
      avatarCanvas: viewportRef.current!,
      backgroundLayer: bgLayerRef.current!,
      backgroundCanvas: bgCanvasRef.current,
      renderWhenIdle: true,
      onScene: setScene,
      onModels: setModels,
      onBackgrounds: setBackgrounds,
      onTrackingStatus: setTracking,
      onConnection: setConnected,
      onModelLoaded: (m) => setModelName(m.manifest.name ?? null),
    });
    playerRef.current = player;
    player.connect();
    return () => {
      player.disconnect();
      playerRef.current = null;
    };
  }, []);

  return (
    <div className="app">
      <TopBar
        playerRef={playerRef}
        scene={scene}
        models={models}
        backgrounds={backgrounds}
        connected={connected}
        tracking={tracking}
      />
      <Viewport
        playerRef={playerRef}
        scene={scene}
        modelName={modelName}
        viewportRef={viewportRef}
        bgLayerRef={bgLayerRef}
        bgCanvasRef={bgCanvasRef}
      />
    </div>
  );
}
