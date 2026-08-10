/**
 * Vite build for the parallel Console SPA (ui-next).
 * Dev server :6537 with /console → :6533 proxy. Not the shipped staticDir yet.
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": resolve(here, "src"),
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
