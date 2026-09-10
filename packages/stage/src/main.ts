// Stage entry: render-only, transparent, no UI. The Player owns the socket,
// the scene and the 60fps loop; this file only wires up the DOM and sizes the
// WebGL canvas. The stage never sends messages — Go Live and every edit come
// from the control panel through the server.

import { Player } from "@oar/player";
import "./styles.css";

const viewport = document.querySelector<HTMLCanvasElement>("#viewport")!;
const bgLayer = document.querySelector<HTMLElement>("#bg-layer")!;
const bgCanvas = document.querySelector<HTMLCanvasElement>("#bg-canvas")!;

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const player = new Player({
  role: "stage",
  wsUrl: `${protocol}//${location.host}/ws`,
  avatarCanvas: viewport,
  backgroundLayer: bgLayer,
  backgroundCanvas: bgCanvas,
  // Blank until the control panel flips live. Alpha stays clean for OBS.
  renderWhenIdle: false,
  onConnection: (connected) => {
    document.title = connected
      ? "open-avatar stage"
      : "open-avatar stage (offline)";
  },
});

// The renderer's camera math is in CSS pixels (clientWidth/Height); the
// backing store is device pixels so a hi-dpi browser source stays sharp.
function resize(): void {
  const dpr = window.devicePixelRatio || 1;
  viewport.width = Math.max(64, Math.floor(window.innerWidth * dpr));
  viewport.height = Math.max(64, Math.floor(window.innerHeight * dpr));
}
window.addEventListener("resize", resize);
resize();

player.connect();
