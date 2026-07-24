/**
 * Postgres / pgvector / Timescale image recipe (≤15 lines of recipe body).
 */

import { credEnv } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Postgres-protocol servers (Postgres · Neon · Supabase · pgvector · Timescale). */
export const postgres: ImageRecipe = {
  id: "postgres",
  port: 5432,
  match: (i) => /postgres|pgvector|timescale/i.test(i),
  apply: (s) => ({
    environment: { POSTGRES_USER: credEnv(s, "USER"), POSTGRES_PASSWORD: credEnv(s, "PASSWORD"), POSTGRES_DB: credEnv(s, "DB") },
    healthcheck: { test: ["CMD-SHELL", "pg_isready -U $$POSTGRES_USER"], interval: "5s", timeout: "3s", retries: 10 },
  }),
  url: (_s, c) => `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
