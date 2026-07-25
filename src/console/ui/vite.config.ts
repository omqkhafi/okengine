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

export default defineConfig({
  root: resolve(here, "shell"),
  plugins: [react(), tailwindcss()],
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    target: "esnext",
    cssCodeSplit: false,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (
            id.includes("/console/ui/shell/panels/flows/") ||
            id.includes("/console/ui/shell/panels/Flows.") ||
            id.includes("/console/ui/flows/") ||
            id.includes("@codemirror/")
          ) {
            return "panel-flows";
          }
          if (
            id.includes("/console/ui/shell/panels/traces/") ||
            id.includes("/console/ui/shell/panels/Traces.") ||
            id.includes("/console/ui/traces/")
          ) {
            return "panel-traces";
          }
          if (
            id.includes("/console/ui/shell/panels/runs/") ||
            id.includes("/console/ui/shell/panels/Runs.") ||
            id.includes("/console/ui/runs/")
          ) {
            return "panel-runs";
          }
          return undefined;
        },
      },
    },
  },
  server: {
    port: 6534,
    strictPort: true,
  },
});
