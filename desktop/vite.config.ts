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
import type { Plugin } from "vite";
import react from "@vitejs/plugin-react";
import * as fs from "node:fs/promises";
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

/**
 * The user documentation, copied into the bundle.
 *
 * [ADR 0018](../docs/decisions/0018-user-docs-live-in-guides-and-reference.md)
 * chose plain Markdown in the repository and named this as the gap it did not
 * close: someone who installs a `.app` has no reason to ever visit GitHub and
 * no way to find out what `::` means. Packaging is when that stops being
 * hypothetical.
 *
 * Copied rather than duplicated: `docs/guides/` and `docs/reference/` remain
 * the single source, and the Help window renders those same files. A second
 * copy written for the app would drift within two releases, which is the
 * outcome the ADR was trying to avoid.
 *
 * `design/` and `decisions/` are deliberately NOT bundled — they are
 * contributor material, and shipping them to a user is how a Help window
 * becomes something nobody reads.
 */
function bundleDocs(): Plugin {
  const SETS = ["guides", "reference"] as const;

  return {
    name: "geode-bundle-docs",
    apply: "build",
    async closeBundle() {
      const outDir = path.join(HERE, "dist", "electron", "renderer", "docs");
      await fs.mkdir(outDir, { recursive: true });

      const manifest: Array<{ set: string; file: string; title: string }> = [];
      for (const set of SETS) {
        const from = path.join(REPO, "docs", set);
        for (const name of (await fs.readdir(from)).filter((n) => n.endsWith(".md"))) {
          const body = await fs.readFile(path.join(from, name), "utf8");
          await fs.writeFile(path.join(outDir, `${set}-${name}`), body);
          // The first `# ` heading is the title. Falling back to the filename
          // keeps a doc that forgets one out of the list as `some-file.md`
          // rather than as a blank row.
          const heading = /^#\s+(.+)$/m.exec(body);
          manifest.push({ set, file: `${set}-${name}`, title: heading?.[1] ?? name });
        }
      }
      await fs.writeFile(path.join(outDir, "index.json"), JSON.stringify(manifest, null, 2));
    },
  };
}

export default defineConfig({
  root: path.join(REPO, "src", "electron", "renderer"),
  plugins: [react(), bundleDocs()],
  resolve: {
    alias: {
      react: fromDesktop("react"),
      "react-dom": fromDesktop("react-dom"),
      "react/jsx-runtime": fromDesktop("react/jsx-runtime"),
      "react/jsx-dev-runtime": fromDesktop("react/jsx-dev-runtime"),
      marked: fromDesktop("marked"),
      dompurify: fromDesktop("dompurify"),
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
