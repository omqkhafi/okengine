/**
 * Postgres / pgvector / Timescale image recipe (≤15 lines of recipe body).
 */

import { credEnv } from "../helpers.ts";
import type { ImageRecipe, ServiceSpec } from "../types.ts";

const postgresEnv = (s: ServiceSpec) => ({
  POSTGRES_USER: credEnv(s, "USER"),
  POSTGRES_PASSWORD: credEnv(s, "PASSWORD"),
  POSTGRES_DB: credEnv(s, "DB"),
});

const postgresHealth = {
  test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"],
  interval: "5s",
  timeout: "3s",
  retries: 10,
};

/** Postgres-protocol servers (Postgres · Neon · Supabase · pgvector · Timescale). */
export const postgres: ImageRecipe = {
  id: "postgres",
  port: 5432,
  match: (i) => /postgres|pgvector|timescale/i.test(i),
  apply: (s) => ({ environment: postgresEnv(s), healthcheck: postgresHealth }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
