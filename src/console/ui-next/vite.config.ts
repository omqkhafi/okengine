/**
 * Vite build for the Console SPA.
 * Dev server :6537 with /console → kernel proxy.
 * `oke dev` sets `OKE_CONSOLE_KERNEL=0` so Vite is SPA/HMR only.
 *
 * Scripts:
 * - `dev:console` — fixed operator
 * - `dev:console:seed` — fixed operator + Manifest/traces (`OKE_CONSOLE_SEEDED=1`)
 * - `dev:console:fresh` — claim open (`OKE_CONSOLE_FRESH=1`)
 * - `dev:console:fresh:seed` — claim + seed
 */

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import {
  isConsoleFresh,
  isConsoleKernelSkipped,
  UI_NEXT_DEV_OPERATOR,
} from "./ui-next-dev-operator.ts";
import { okeConsoleKernelPlugin } from "./vite-console-kernel-plugin.ts";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(here, "../../../package.json"), "utf8")) as {
  version: string;
};

export default defineConfig(({ command }) => {
  const injectDevOperator = command === "serve" && !isConsoleFresh() ? UI_NEXT_DEV_OPERATOR : null;
  const attachToOkeDev = isConsoleKernelSkipped();
  const consoleProxy = process.env["OKE_CONSOLE_PROXY"] ?? "http://127.0.0.1:6533";

  return {
    root: here,
    plugins: [react(), tailwindcss(), ...(attachToOkeDev ? [] : [okeConsoleKernelPlugin()])],
    define: {
      __OKE_VERSION__: JSON.stringify(pkg.version),
      __OKE_DEV_OPERATOR__: JSON.stringify(injectDevOperator),
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
      // Keep minified chunks under Vite's 500 kB warning. Route pages are
      // lazy; these groups pull the remaining heavy static vendors out of
      // the entry (Shiki is already a slim core + five grammars).
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: "react-dom", test: /[\\/]node_modules[\\/]react-dom[\\/]/ },
              { name: "xyflow", test: /[\\/]node_modules[\\/]@xyflow[\\/]/ },
            ],
          },
        },
      },
    },
    server: {
      port: 6537,
      strictPort: true,
      proxy: {
        "/console": {
          target: consoleProxy,
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
