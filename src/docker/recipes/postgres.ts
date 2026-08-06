/**
 * Postgres / pgvector / Timescale image recipe (≤15 lines of recipe body).
 */

import { postgresEnv, postgresHealth } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Postgres-protocol servers (Postgres · Neon · Supabase · pgvector · Timescale). */
export const postgres: ImageRecipe = {
  id: "postgres",
  port: 5432,
  match: (i) => /postgres|pgvector|timescale/i.test(i),
  apply: (s) => ({ environment: postgresEnv(s), healthcheck: postgresHealth }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
