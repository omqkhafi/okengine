/**
 * App core — element wiring loaded by `import "@/core"` from `app.ts`.
 *
 * Order matches how you usually extend the starter:
 * locales → store → gate → vault → channel → (AI via `oke ai setup`).
 * Vault contracts live in `src/vault.ts` (re-exported below).
 */

import "@/locales";

import { store } from "okengine";
import * as schema from "@/db/schema";

export * from "@/vault";

// --- Store -------------------------------------------------------------------

/** SQL store (`schema.ts`). Drivers: pglite locally · postgres in docker. */
export const db = store.sql("app", { schema });

// --- AI ----------------------------------------------------------------------
// Appended by `oke ai setup` / `create-oke --ai`.
// Registry cloud: provider "openrouter" + OPENROUTER_API_KEY (no baseUrl).
// Local self-host still needs an explicit baseUrl (or OKE_AI_URL on the binding).
