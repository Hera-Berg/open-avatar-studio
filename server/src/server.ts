// open-avatar-studio server. One process, three ports — one listener per
// role, matching the dev topology so OBS and the browser never think about a
// subpath:
//
//   :3002  control panel (built bundle)
//   :3003  stage         (built bundle — the OBS browser source)
//   :3100  API + files + websocket (also serves the control panel)
//
// Every listener shares the same HTTP and WebSocket handlers, so browsers on
// any port reach /ws, /api and /files same-origin.
//
//   GET  /ws                     → browser websocket (scene, lists, tracking)
//   GET  /api/health|scene|models|backgrounds
//   POST /api/uploads?kind=&name=   → raw-body file upload (.oar / image)
//   DELETE /api/models/:id | /api/backgrounds/:id
//   GET  /files/models/* | /files/backgrounds/*
//
// In dev, vite serves the stage (:3003) and control (:3002) and proxies
// /ws,/api,/files to :3100. In prod the server serves the built bundles
// itself on 3002/3003/3100.

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import {
  createReadStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  join,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocket, WebSocketServer } from "ws";
import { parseClientMessage, type ClientMessage, type TrackingStatus } from "@oar/shared";
import { SceneStore } from "./sceneStore";
import { TrackerClient } from "./trackerClient";

const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? 3002);
const STAGE_PORT = Number(process.env.STAGE_PORT ?? 3003);
const PORT = Number(process.env.PORT ?? 3100);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const DATA_DIR = resolve(process.env.DATA_DIR ?? join(ROOT, "data"));
const MODELS_DIR = join(DATA_DIR, "models");
const BACKGROUNDS_DIR = join(DATA_DIR, "backgrounds");
// Present only after a prod build (server build copies them into dist/).
const STAGE_DIR = join(HERE, "stage");
const CONTROL_DIR = join(HERE, "control");

mkdirSync(MODELS_DIR, { recursive: true });
mkdirSync(BACKGROUNDS_DIR, { recursive: true });

// ------------------------------------------------------------ file lists

function listModels() {
  return readdirSync(MODELS_DIR)
    .filter((f) => f.toLowerCase().endsWith(".oar"))
    .map((f) => {
      const st = statSync(join(MODELS_DIR, f));
      return {
        id: f,
        name: f.replace(/\.oar$/i, ""),
        url: `/files/models/${encodeURIComponent(f)}`,
        uploadedAt: st.mtimeMs,
      };
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

function listBackgrounds() {
  return readdirSync(BACKGROUNDS_DIR)
    .filter((f) => IMAGE_EXT.has(extname(f).toLowerCase()))
    .map((f) => {
      const st = statSync(join(BACKGROUNDS_DIR, f));
      return {
        id: f,
        name: f.replace(/\.[^.]+$/, ""),
        url: `/files/backgrounds/${encodeURIComponent(f)}`,
        uploadedAt: st.mtimeMs,
      };
    })
    .sort((a, b) => b.uploadedAt - a.uploadedAt);
}

const store = new SceneStore(DATA_DIR);
store.setModels(listModels());
store.setBackgrounds(listBackgrounds());

// ------------------------------------------------------------- client hub

const clients = new Set<WebSocket>();

function broadcast(obj: unknown): void {
  const text = JSON.stringify(obj);
  for (const ws of clients) {
    if (ws.readyState === WebSocket.OPEN) ws.send(text);
  }
}

// ------------------------------------------------------------ tracker

// The server is the only tracker reader, exactly like the creator's
// TrackerClient: parse + smooth server-side, broadcast the parsed frames.
// Status derives from the client's ConnectionState plus frame silence — the
// tracker goes silent, it does not close, when the camera dies.

const STALL_AFTER_MS = 2000;

let trackerStatus: TrackingStatus = "disconnected";
let lastFrameAt = 0;
let frameSeen = false;
let trackerStalled = false;

function setTrackerStatus(status: TrackingStatus): void {
  if (trackerStatus === status) return;
  trackerStatus = status;
  broadcast({ type: "tracking.status", status });
}

const tracker = new TrackerClient({
  url: process.env.TRACKER_URL ?? "ws://localhost:3000/ws/v1/tracking",
  debugUrl: process.env.TRACKER_DEBUG_URL ?? "ws://localhost:3000/ws/v1/debug",
  onFrame: (params, input) => {
    lastFrameAt = Date.now();
    frameSeen = true;
    if (trackerStalled) {
      trackerStalled = false;
      setTrackerStatus("connected");
    }
    broadcast({
      type: "tracking.frame",
      params,
      blendshapes: input.blendshapes ?? null,
      present: input.present,
    });
  },
  onState: (state) => {
    switch (state) {
      case "connecting":
        return setTrackerStatus("connecting");
      case "connected":
        frameSeen = false;
        trackerStalled = false;
        return setTrackerStatus("connected");
      case "disconnected":
      case "error":
        return setTrackerStatus("disconnected");
    }
  },
});
tracker.start();

setInterval(() => {
  if (!frameSeen || trackerStatus !== "connected") return;
  if (Date.now() - lastFrameAt > STALL_AFTER_MS) {
    trackerStalled = true;
    setTrackerStatus("stalled");
  }
}, 500);

// ---------------------------------------------------------------- websocket

const wss = new WebSocketServer({ noServer: true });

function onClientMessage(ws: WebSocket, text: string): void {
  const msg: ClientMessage | null = parseClientMessage(text);
  if (!msg) return;
  if (msg.type === "tracking.config") {
    tracker.setConfig({ blinkFloor: msg.blinkFloor, mouthGain: msg.mouthGain });
    return;
  }
  const scene = store.apply(msg);
  broadcast({ type: "scene.state", scene });
}

wss.on("connection", (ws: WebSocket) => {
  clients.add(ws);
  ws.send(JSON.stringify({ type: "scene.state", scene: store.value }));
  ws.send(JSON.stringify({ type: "model.list", models: store.models }));
  ws.send(JSON.stringify({ type: "background.list", backgrounds: store.backgrounds }));
  ws.send(JSON.stringify({ type: "tracking.status", status: trackerStatus }));
  ws.on("message", (data) => onClientMessage(ws, String(data)));
  ws.on("close", () => clients.delete(ws));
  ws.on("error", () => clients.delete(ws));
});

// ------------------------------------------------------------ http helpers

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

function sendFile(res: ServerResponse, absPath: string): void {
  const st = statSync(absPath);
  if (st.isDirectory()) {
    sendFile(res, join(absPath, "index.html"));
    return;
  }
  const type = MIME[extname(absPath).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, {
    "Content-Type": type,
    "Content-Length": st.size,
    "Cache-Control": extname(absPath) === ".html" ? "no-cache" : "public, max-age=31536000, immutable",
  });
  createReadStream(absPath).pipe(res);
}

/** Serve a file within `root` (SPA fallback to index.html). Returns true if handled. */
function serveFromDir(res: ServerResponse, root: string, rel: string): boolean {
  const abs = resolve(root, "." + rel);
  if (abs !== root && !abs.startsWith(root + sep)) {
    sendJson(res, 403, { error: "forbidden" });
    return true;
  }
  if (existsSync(abs) && statSync(abs).isFile()) {
    sendFile(res, abs);
    return true;
  }
  const index = join(root, "index.html");
  if (existsSync(index)) {
    sendFile(res, index);
    return true;
  }
  sendJson(res, 404, { error: "not found" });
  return true;
}

// --------------------------------------------------------------- uploads

function safeName(raw: string): string | null {
  const name = basename(raw);
  if (!name || name === "." || name === ".." || name.startsWith(".")) return null;
  if (name.includes("/") || name.includes("\\")) return null;
  return name;
}

function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("payload too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolveBody(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

// ---------------------------------------------------------------- routing

const handleRequest = (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const path = url.pathname;
  const port = req.socket.localPort;
  try {
    // API
    if (path === "/api/health") {
      return sendJson(res, 200, { ok: true, tracker: trackerStatus });
    }
    if (path === "/api/scene" && req.method === "GET") {
      return sendJson(res, 200, { scene: store.value });
    }
    if (path === "/api/models" && req.method === "GET") {
      return sendJson(res, 200, { models: store.models });
    }
    if (path === "/api/backgrounds" && req.method === "GET") {
      return sendJson(res, 200, { backgrounds: store.backgrounds });
    }

    if (path === "/api/uploads" && req.method === "POST") {
      return void handleUpload(req, res, url);
    }

    if (path.startsWith("/api/models/") && req.method === "DELETE") {
      return void handleDelete(req, res, "model", decodeURIComponent(path.slice("/api/models/".length)));
    }
    if (path.startsWith("/api/backgrounds/") && req.method === "DELETE") {
      return void handleDelete(req, res, "background", decodeURIComponent(path.slice("/api/backgrounds/".length)));
    }

    // Files
    if (path.startsWith("/files/models/")) {
      return void handleFileGet(req, res, MODELS_DIR, decodeURIComponent(path.slice("/files/models/".length)));
    }
    if (path.startsWith("/files/backgrounds/")) {
      return void handleFileGet(req, res, BACKGROUNDS_DIR, decodeURIComponent(path.slice("/files/backgrounds/".length)));
    }

    // Static (prod). The port picks which bundle serves the root.
    if (port === STAGE_PORT) {
      return serveFromDir(res, STAGE_DIR, path);
    }
    if (port === CONTROL_PORT) {
      return serveFromDir(res, CONTROL_DIR, path);
    }
    // API port (:3100): control panel at /, /stage* redirects to the stage port.
    if (path === "/stage" || path.startsWith("/stage/")) {
      res.writeHead(302, { Location: `http://localhost:${STAGE_PORT}/` });
      res.end();
      return;
    }
    return serveFromDir(res, CONTROL_DIR, path);
  } catch (e) {
    console.error("[server] request failed:", e);
    return sendJson(res, 500, { error: String(e) });
  }
};

function handleFileGet(
  _req: IncomingMessage,
  res: ServerResponse,
  dir: string,
  name: string,
): void {
  const safe = safeName(name);
  if (!safe) return sendJson(res, 400, { error: "bad name" });
  const abs = resolve(dir, safe);
  if (abs !== dir && !abs.startsWith(dir + sep)) return sendJson(res, 403, { error: "forbidden" });
  if (!existsSync(abs) || statSync(abs).isDirectory()) return sendJson(res, 404, { error: "not found" });
  sendFile(res, abs);
}

function handleDelete(
  _req: IncomingMessage,
  res: ServerResponse,
  kind: "model" | "background",
  id: string,
): void {
  const safe = safeName(id);
  const dir = kind === "model" ? MODELS_DIR : BACKGROUNDS_DIR;
  if (!safe || !existsSync(join(dir, safe))) return sendJson(res, 404, { error: "not found" });
  unlinkSync(join(dir, safe));
  if (kind === "model") {
    store.setModels(listModels());
  } else {
    store.setBackgrounds(listBackgrounds());
  }
  const scene = store.reconcile();
  broadcast({ type: "scene.state", scene });
  broadcast({
    type: kind === "model" ? "model.list" : "background.list",
    [kind === "model" ? "models" : "backgrounds"]: store[kind === "model" ? "models" : "backgrounds"],
  });
  sendJson(res, 200, { ok: true });
}

async function handleUpload(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
): Promise<void> {
  const kind = url.searchParams.get("kind");
  const name = safeName(url.searchParams.get("name") ?? "");
  if ((kind !== "model" && kind !== "background") || !name) {
    return sendJson(res, 400, { error: "bad request" });
  }
  const ext = extname(name).toLowerCase();
  if (kind === "model" && ext !== ".oar") {
    return sendJson(res, 400, { error: "model must be .oar" });
  }
  if (kind === "background" && !IMAGE_EXT.has(ext)) {
    return sendJson(res, 400, { error: "background must be an image" });
  }
  const dir = kind === "model" ? MODELS_DIR : BACKGROUNDS_DIR;
  const limit = kind === "model" ? 512 * 1024 * 1024 : 64 * 1024 * 1024;
  let body: Buffer;
  try {
    body = await readBody(req, limit);
  } catch (e) {
    return sendJson(res, 413, { error: String(e) });
  }
  writeFileSync(join(dir, name), body);
  if (kind === "model") {
    store.setModels(listModels());
  } else {
    store.setBackgrounds(listBackgrounds());
  }
  broadcast({
    type: kind === "model" ? "model.list" : "background.list",
    [kind === "model" ? "models" : "backgrounds"]: store[kind === "model" ? "models" : "backgrounds"],
  });
  const item = (kind === "model" ? store.models : store.backgrounds).find((x) => x.id === name);
  sendJson(res, 200, { ok: true, [kind]: item ?? null });
}

// ---------------------------------------------------------------- boot

const handleUpgrade = (
  req: IncomingMessage,
  socket: import("node:stream").Duplex,
  head: Buffer,
): void => {
  const path = (req.url ?? "").split("?")[0];
  if (path === "/ws") {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
  } else {
    socket.destroy();
  }
};

function startServer(name: string, port: number, srv: ReturnType<typeof createServer>): void {
  srv.on("upgrade", handleUpgrade);
  srv.listen(port, () => console.log(`[server] ${name} on :${port}`));
}

const controlServer = createServer(handleRequest);
const stageServer = createServer(handleRequest);
const apiServer = createServer(handleRequest);

// Dev: vite owns :3002/:3003, so the server only binds them when it is the
// one serving the built bundles (prod / Docker). `SERVE_APPS=0` opts out.
if (process.env.SERVE_APPS !== "0") {
  startServer("control panel", CONTROL_PORT, controlServer);
  startServer("stage (OBS source)", STAGE_PORT, stageServer);
} else {
  console.log(`[server] app ports disabled (dev: vite serves :${CONTROL_PORT}/:${STAGE_PORT})`);
}
startServer("api + websocket", PORT, apiServer);
console.log(`[server] data dir: ${DATA_DIR}`);
console.log(`[server] tracker: ${trackerStatus}`);

// Keep the file lists fresh if files are dropped into data/ manually.
setInterval(() => {
  const m = JSON.stringify(listModels());
  const b = JSON.stringify(listBackgrounds());
  if (m !== JSON.stringify(store.models)) {
    store.setModels(listModels());
    broadcast({ type: "model.list", models: store.models });
  }
  if (b !== JSON.stringify(store.backgrounds)) {
    store.setBackgrounds(listBackgrounds());
    broadcast({ type: "background.list", backgrounds: store.backgrounds });
  }
}, 10000);

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    tracker.stop();
    for (const srv of [apiServer, controlServer, stageServer]) {
      srv.close();
    }
    setTimeout(() => process.exit(0), 100);
  });
}
