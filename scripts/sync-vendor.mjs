#!/usr/bin/env node
// Syncs @oar/core and @oar/renderer source from the sibling open-avatar-creator
// repo into vendor/, keeping the studio a self-contained Docker build context
// while preserving a single evaluator + renderer. Never hand-edit vendor/.
//
//   npm run sync:vendor
//
// The studio imports these packages by name (@oar/core, @oar/renderer) and
// tsconfig.base.json + each app's vite alias resolve them to vendor/.

import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const creatorRoot =
  process.env.CREATOR_ROOT ?? join(root, "..", "open-avatar-creator");

const packages = [
  { name: "@oar/core", dir: "core" },
  { name: "@oar/renderer", dir: "renderer" },
];

let ok = true;
for (const pkg of packages) {
  const from = join(creatorRoot, "packages", pkg.dir, "src");
  const target = join(root, "vendor", pkg.name, "src");
  mkdirSync(dirname(target), { recursive: true });

  if (!existsSync(from)) {
    // The sibling creator repo is not here (Docker build, CI, fresh clone).
    // vendor/ is committed, so this is only a problem if it is missing too.
    if (existsSync(target)) {
      console.log(
        `[sync:vendor] ${pkg.name}: creator source absent, keeping vendored copy`,
      );
      continue;
    }
    console.error(`[sync:vendor] missing source for ${pkg.name}: ${from}`);
    ok = false;
    continue;
  }

  rmSync(target, { recursive: true, force: true });
  cpSync(from, target, { recursive: true });
  console.log(
    `[sync:vendor] ${pkg.name} <- open-avatar-creator/packages/${pkg.dir}/src`,
  );
}

if (!ok) {
  console.error(
    "[sync:vendor] failed — expected open-avatar-creator at ../open-avatar-creator",
  );
  process.exit(1);
}
console.log("[sync:vendor] done");
