# open-avatar-studio

An open-source VTube Studio replacement: a render-only **stage** for OBS
capture, a **control panel** to edit the scene, and a **server** that owns the
scene and **reads face tracking** — all reusing the open-avatar creator's
evaluator, renderer and `.oar` model format verbatim.

```
open-avatar-tracker  (:3000, the creator's MediaPipe/FastAPI server)
   ▲ ws://…/ws/v1/tracking + /ws/v1/debug
open-avatar-studio server  (one process, three ports)
   ├── scene store (persisted to data/scene.json)
   ├── file store (data/models/*.oar, data/backgrounds/*.png)
   ├── tracker client → the creator's TrackerClient: parses + smooths frames,
   │   then broadcasts them to every client (same blink floor / mouth gain)
   ├── :3002 control app (the panel: pick model, Go Live, move it)
   ├── :3003 stage app (the OBS browser source, transparent)
   └── :3100 api + websocket (files, uploads, sockets)
```

The stage and control panel are separate browser instances with **no shared
client state**: everything the stage renders arrives over its websocket or over
HTTP. The stage is idle and transparent until you press **Go Live** in the
control panel, then it renders instantly (it solves every frame regardless, so
there is no first-frame lag).

## Dev

```bash
npm install
npm run dev
```

- Control panel: http://localhost:3002
- Stage: http://localhost:3003
- Server (API/WS): http://localhost:3100

Vite dev servers proxy `/ws`, `/api` and `/files` to the server, so both apps
work with zero CORS or origin config. Requires the tracker from
[open-avatar-creator](https://github.com/anomalyco/open-avatar) to be running on
`:3000` (optional — the studio runs fine without it, tracking just shows
`disconnected`).

## Production

```bash
npm run build
npm start        # one process serving :3002 (control), :3003 (stage), :3100 (api)
```

Or with Docker:

```bash
docker compose up -d --build
```

The ports are the same in dev, prod and Docker: the panel at
`http://localhost:3002`, the stage at `http://localhost:3003`.

## OBS setup

1. Add a **Browser** source with URL `http://localhost:3003` (dev, prod and
   Docker are identical).
2. Keep the page background transparent — the stage keeps alpha, so the scene
   composits over your OBS background. Choose **Transparent (OBS)** in the
   panel's background menu. For non-OBS capture paths, **Chroma green**
   (`#00B140`) is one click away.
3. Resolution follows the browser source's canvas; set the browser source to
   your stream resolution.

## Control panel

- **Model** dropdown — pick an uploaded `.oar`; **Add model** uploads one.
- **Background** dropdown — transparent / chroma green / any uploaded image.
- **Go Live** — flips the stage from blank to rendering the current scene.
- **Lock position** — pins the avatar so gestures can't move it mid-stream.
- Drag to move the avatar, scroll to zoom, **Reset view** re-fits it.
- Uploaded `.oar` files and background images are stored server-side in
  `data/models` and `data/backgrounds` (persisted, hot-reloaded).

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3100` | Studio server port |
| `DATA_DIR` | `<repo>/data` | Models, backgrounds, `scene.json` |
| `TRACKER_URL` | `ws://localhost:3000/ws/v1/tracking` | Tracker feed |
| `TRACKER_DEBUG_URL` | `ws://localhost:3000/ws/v1/debug` | 52-blendshape feed |

The tracker is a separate process — start it first (`docker compose up` in
`open-avatar-tracker`, or `uvicorn backend.app.main:app --host 0.0.0.0 --port 3000`).
The studio reconnects until the tracker appears; tracking just shows
`disconnected`/`stalled` until frames arrive.

In Docker, `TRACKER_URL` defaults to `ws://host.docker.internal:3000/...` and
`docker-compose.yml` maps `host.docker.internal` to the host gateway
(`extra_hosts: host-gateway`), so the container reaches a tracker running on
the host. Override `TRACKER_URL`/`TRACKER_DEBUG_URL` if the tracker runs
elsewhere.

## Layout

- `packages/shared` — scene + protocol types shared by server, panel and stage.
- `packages/player` — the 60fps playback loop (socket, scene, tracking, render),
  used identically by the stage and the control preview.
- `packages/stage` — render-only, no UI; the OBS source.
- `packages/control` — React panel that edits the server-owned scene.
- `server` — one process, three ports: HTTP + WebSocket, uploads, and the
  tracker client (reads the tracker's websocket, parses/smooths, broadcasts).
- `vendor/@oar/{core,renderer}` — the creator's evaluator/renderer, synced by
  `npm run sync:vendor` (never edit by hand).

## `.oar` models

A `.oar` is the open-avatar model format: a zip containing `manifest.json`,
`layers/*.png` and an optional `thumbnail.png`, exported by the creator app.
Unpacking happens in the browser (`readOar`), so the server only stores and
serves the file.
