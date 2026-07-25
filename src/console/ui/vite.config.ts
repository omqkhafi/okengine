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
          if (
            id.includes("/console/ui/shell/panels/signals/") ||
            id.includes("/console/ui/shell/panels/Signals.") ||
            id.includes("/console/ui/signals/")
          ) {
            return "panel-signals";
          }
          if (
            id.includes("/console/ui/shell/panels/store/") ||
            id.includes("/console/ui/shell/panels/Store.") ||
            id.includes("/console/ui/store/")
          ) {
            return "panel-store";
          }
          if (
            id.includes("/console/ui/shell/panels/clock/") ||
            id.includes("/console/ui/shell/panels/Clock.") ||
            id.includes("/console/ui/clock/")
          ) {
            return "panel-clock";
          }
          if (
            id.includes("/console/ui/shell/panels/vault/") ||
            id.includes("/console/ui/shell/panels/Vault.") ||
            id.includes("/console/ui/vault/")
          ) {
            return "panel-vault";
          }
          if (
            id.includes("/console/ui/shell/panels/ai/") ||
            id.includes("/console/ui/shell/panels/Ai.") ||
            id.includes("/console/ui/ai/")
          ) {
            return "panel-ai";
          }
          if (
            id.includes("/console/ui/shell/panels/diff/") ||
            id.includes("/console/ui/shell/panels/Diff.") ||
            id.includes("/console/ui/diff/")
          ) {
            return "panel-diff";
          }
          if (
            id.includes("/console/ui/shell/panels/architecture/") ||
            id.includes("/console/ui/shell/panels/Architecture.") ||
            id.includes("/console/ui/architecture/")
          ) {
            return "panel-architecture";
          }
          if (
            id.includes("/console/ui/shell/panels/access/") ||
            id.includes("/console/ui/shell/panels/Access.") ||
            id.includes("/console/ui/access/")
          ) {
            return "panel-access";
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
