/**
 * YugabyteDB image recipe — self-hosted single-node YSQL (Postgres-wire).
 *
 * Driver id stays `postgres`. Official image: `yugabytedb/yugabyte`.
 */

import { yugabyteEnv, yugabyteHealth } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** YugabyteDB — YSQL on 5433. */
export const yugabyte: ImageRecipe = {
  id: "yugabyte",
  port: 5433,
  match: (i) => /yugabyte/i.test(i),
  apply: (s) => ({
    environment: yugabyteEnv(s),
    command: ["bin/yugabyted", "start", "--base_dir=/home/yugabyte/yb_data", "--background=false"],
    healthcheck: yugabyteHealth,
    volumes: [`${s.serviceName}-data:/home/yugabyte/yb_data`],
  }),
  url: (_s, c) =>
    `postgres://${c.user}:${encodeURIComponent(c.password)}@${c.host}:${c.port}/${c.database}`,
};
