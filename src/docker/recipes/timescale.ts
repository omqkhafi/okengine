/**
 * TimescaleDB image recipe — Postgres + hypertables (same POSTGRES_* contract).
 *
 * Driver id stays `postgres`. Matched ahead of the generic Postgres recipe.
 */

import { TIMESCALE_STAT_STATEMENTS_COMMAND, postgresEnv, postgresHealth } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** TimescaleDB — Postgres protocol on 5432. */
export const timescale: ImageRecipe = {
  id: "timescale",
  port: 5432,
  match: (i) => /timescale/i.test(i),
  apply: (s) => ({
    environment: postgresEnv(s),
    healthcheck: postgresHealth,
    command: [...TIMESCALE_STAT_STATEMENTS_COMMAND],
  }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
