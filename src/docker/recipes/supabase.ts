/**
 * Supabase image recipe — self-hosted `supabase/postgres` (Postgres + bundled extensions).
 *
 * Postgres-protocol only: the Auth / Storage / Realtime / Kong / Studio layer of the
 * full Supabase stack is not run here — oke already covers those with Vault, Store ·
 * files, and Signal. This recipe just gets you Postgres plus Supabase's extension
 * bundle (pgvector, pg_graphql, pg_cron, wrappers, …) without the rest of the platform.
 */

import { postgresEnv, postgresHealth } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Supabase Postgres image — checked before the generic `postgres` recipe. */
export const supabase: ImageRecipe = {
  id: "supabase",
  port: 5432,
  match: (i) => /supabase\/postgres/i.test(i),
  apply: (s) => ({ environment: postgresEnv(s), healthcheck: postgresHealth }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
