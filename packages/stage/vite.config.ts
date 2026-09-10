import { defineConfig } from "vite";
import { fileURLToPath } from "node:url";

// @oar/core and @oar/renderer resolve to the vendored creator source, so the
// evaluator and renderer are shared verbatim.
const vendor = (pkg: string) =>
  fileURLToPath(new URL(`../../vendor/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  server: {
    port: 3003,
    host: true,
    proxy: {
      "/ws": { target: "ws://localhost:3100", ws: true },
      "/api": "http://localhost:3100",
      "/files": "http://localhost:3100",
    },
  },
  build: {
    outDir: "dist",
    target: "es2022",
  },
  resolve: {
    alias: {
      "@oar/core": vendor("@oar/core"),
      "@oar/renderer": vendor("@oar/renderer"),
    },
  },
});
