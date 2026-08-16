/**
 * Vite 8 SPA for the Notes starter.
 *
 * `index.html` is the documented entry (not backend-integration HTML).
 * The oke app stays on :6530. `server.proxy` keeps `createClient("")`
 * same-origin — leave CORS at Vite's localhost default. `preview.proxy` inherits
 * this map. Do not proxy `/` — `main.root` is `GET /` and would steal the SPA.
 */

import react from "@vitejs/plugin-react";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type ProxyOptions } from "vite";

const root = dirname(fileURLToPath(import.meta.url));

/** Local oke app (`oke dev`). */
const APP_ORIGIN = "http://127.0.0.1:6530";

const proxy: Record<string, ProxyOptions> = {
  "/health": { target: APP_ORIGIN, changeOrigin: true },
  "/notes": { target: APP_ORIGIN, changeOrigin: true },
  "/_oke": { target: APP_ORIGIN, changeOrigin: true },
};

export default defineConfig({
  root,
  plugins: [react()],
  // Load `VITE_*` from the app root (same place as `.env.example`).
  envDir: resolve(root, ".."),
  server: { proxy },
});
