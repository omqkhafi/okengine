/**
 * Browser client — Vite proxies these paths to `oke dev` (:6530).
 *
 * `$routes` is passed at runtime so HTTP triggers use REST, not `/_oke` RPC.
 * Do not import `src/app.ts` here — that graph is Bun/server-only.
 */

import { createClient } from "okengine/client";

/** One note from `notes.list` / `notes.create`. */
export type Note = {
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly archivedAt: number | null;
  readonly createdAt: number;
};

const $routes = {
  main: {
    health: { method: "GET", path: "/health" },
  },
  notes: {
    list: { method: "GET", path: "/notes" },
    create: { method: "POST", path: "/notes" },
    get: { method: "GET", path: "/notes/:id" },
    archive: { method: "POST", path: "/notes/:id/archive" },
  },
} as const;

type AppRoutes = { readonly $routes: typeof $routes };

/**
 * Typed caller for starter Flows. `VITE_API_URL` is empty in dev (proxy).
 */
export const api = createClient<AppRoutes>(import.meta.env.VITE_API_URL ?? "", {
  $routes,
});
