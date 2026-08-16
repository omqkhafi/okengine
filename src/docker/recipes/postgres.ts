/**
 * Postgres / pgvector image recipe (≤15 lines of recipe body).
 */

import { POSTGRES_STAT_STATEMENTS_COMMAND, postgresEnv, postgresHealth } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Postgres-protocol servers (Postgres · pgvector). Timescale / Supabase match first. */
export const postgres: ImageRecipe = {
  id: "postgres",
  port: 5432,
  match: (i) => /postgres|pgvector/i.test(i),
  apply: (s) => ({
    environment: postgresEnv(s),
    healthcheck: postgresHealth,
    command: [...POSTGRES_STAT_STATEMENTS_COMMAND],
  }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
