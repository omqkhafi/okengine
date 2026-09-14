/**
 * Shorter store — SQL plus the redirect KV cache.
 *
 * Drivers: pglite locally · postgres in docker; Redis in docker · memory in tests.
 */

import { store } from "okengine";
import * as schema from "@/db/schema";

/** SQL store for Shorter (`src/db/schema`). Drivers: pglite locally · postgres in docker. */
export const db = store.sql("app", { schema });

/** Hot-path redirect cache (`code` → destination). Redis in docker · memory in tests. */
export const redirects = store.kv("redirects");
