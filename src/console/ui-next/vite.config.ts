/**
 * Vite build for the parallel Console SPA (ui-next).
 * Dev server :6537 with /console → :6533 proxy + ephemeral Console kernel.
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { okeConsoleKernelPlugin } from "./vite-console-kernel-plugin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../../../package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss(), okeConsoleKernelPlugin()],
  define: {
    __OKE_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      "@": resolve(here, "src"),
      "@console/password-policy": resolve(here, "../password-policy.ts"),
    },
  },
  build: {
    outDir: resolve(here, "dist"),
    emptyOutDir: true,
    sourcemap: false,
    target: "esnext",
  },
  server: {
    port: 6537,
    strictPort: true,
    proxy: {
      "/console": {
        target: "http://127.0.0.1:6533",
        changeOrigin: true,
      },
    },
  },
});
