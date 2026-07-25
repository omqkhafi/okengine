/**
 * Vite build for the Console SPA shell (console §7).
 * Output is shipped inside the package and served by Bun on 6533.
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

/**
 * Panel chunk id from a module path, or `undefined` for the shell entry.
 *
 * Every lazy panel must resolve to `panel-<id>` so:
 * 1. budget measurement can exclude them from the initial load
 * 2. `modulePreload` can refuse to eagerly fetch them
 *
 * @param id - Rollup module id
 */
function panelChunkOf(id: string): string | undefined {
  const panels: ReadonlyArray<readonly [string, string]> = [
    ["flows", "panel-flows"],
    ["traces", "panel-traces"],
    ["runs", "panel-runs"],
    ["signals", "panel-signals"],
    ["store", "panel-store"],
    ["clock", "panel-clock"],
    ["vault", "panel-vault"],
    ["ai", "panel-ai"],
    ["diff", "panel-diff"],
    ["architecture", "panel-architecture"],
    ["access", "panel-access"],
    ["plugins", "panel-plugins"],
    ["channels", "panel-channels"],
    ["gates", "panel-gates"],
    ["overview", "panel-overview"],
  ];
  for (const [name, chunk] of panels) {
    const pascal = name[0]!.toUpperCase() + name.slice(1);
    if (
      id.includes(`/console/ui/shell/panels/${name}/`) ||
      id.includes(`/console/ui/shell/panels/${pascal}.`) ||
      id.includes(`/console/ui/${name}/`) ||
      (name === "flows" && id.includes("@codemirror/"))
    ) {
      return chunk;
    }
  }
  return undefined;
}

export default defineConfig({
  root: resolve(here, "shell"),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    target: "esnext",
    cssCodeSplit: false,
    // Lazy panels must stay lazy on the wire — Vite's default modulepreload
    // of every dynamic import was pulling all 17 panel chunks into the first
    // navigation (the unexplained 89→138 kB class of "initial" measurements).
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter((dep) => !dep.includes("panel-"));
      },
    },
    rollupOptions: {
      output: {
        manualChunks(id) {
          return panelChunkOf(id);
        },
      },
    },
  },
  server: {
    port: 6534,
    strictPort: true,
  },
});
