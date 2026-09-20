/**
 * Builds the renderer, and nothing else.
 *
 * `tsc` cannot produce a React bundle, so this is the second deviation from
 * "the build is plain tsc" (ADR 0017 records the first, `desktop/` itself).
 * It is confined: main, preload and the IPC contract are still `tsc` from the
 * repo root, and `npm run build` and `npm test` are untouched by it.
 *
 * The root of this build is `src/electron/renderer/` even though the config
 * lives here, because source belongs in `src/` and this package deliberately
 * holds none.
 */

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");

/**
 * Source lives in `src/`, dependencies live here. Node resolves `node_modules`
 * by walking UP from the importing file, so a renderer file under `src/` finds
 * the repo root — which has no React — and not this directory.
 *
 * That is the standing cost of one dependency tree per runtime, and it has now
 * been paid three times: Electron's types, React's types, and here for the
 * bundler. Each is one line, and each is silent when missing.
 */
const fromDesktop = (pkg: string): string =>
  path.join(HERE, "node_modules", pkg);

export default defineConfig({
  root: path.join(REPO, "src", "electron", "renderer"),
  plugins: [react()],
  resolve: {
    alias: {
      react: fromDesktop("react"),
      "react-dom": fromDesktop("react-dom"),
      "react/jsx-runtime": fromDesktop("react/jsx-runtime"),
      "react/jsx-dev-runtime": fromDesktop("react/jsx-dev-runtime"),
    },
  },
  build: {
    outDir: path.join(HERE, "dist", "electron", "renderer"),
    emptyOutDir: true,
    // Electron loads the page with loadFile, so assets must be referenced
    // relatively. An absolute /assets/… path resolves against the filesystem
    // root under file:// and silently 404s.
    assetsDir: "assets",
    rollupOptions: {
      input: path.join(REPO, "src", "electron", "renderer", "index.html"),
    },
  },
  base: "./",
});
