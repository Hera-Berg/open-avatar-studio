// Copies the built stage and control bundles next to the server bundle, so
// `node dist/server.js` serves the whole studio from one process and one port.

import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "dist");
const root = join(here, "..", "..");

for (const [name, dir] of [
  ["stage", join(root, "packages/stage/dist")],
  ["control", join(root, "packages/control/dist")],
]) {
  const out = join(dist, name);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  cpSync(dir, out, { recursive: true });
  console.log(`[server] copied ${name} -> ${out}`);
}
