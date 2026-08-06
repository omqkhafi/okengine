/**
 * CockroachDB image recipe — self-hosted single-node Postgres-wire SQL.
 *
 * Driver id stays `postgres`. Official image: `cockroachdb/cockroach`.
 */

import { cockroachEnv, cockroachHealth } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** CockroachDB — SQL on 26257; DB Console on 8080. */
export const cockroach: ImageRecipe = {
  id: "cockroach",
  port: 26257,
  match: (i) => /cockroach/i.test(i),
  apply: (s) => ({
    environment: cockroachEnv(s),
    command: ["start-single-node", "--accept-sql-without-tls"],
    healthcheck: cockroachHealth,
    volumes: [`${s.serviceName}-data:/cockroach/cockroach-data`],
    extraPorts: [{ host: 8080, container: 8080 }],
  }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}?sslmode=require`,
};
