/**
 * Redis-protocol image recipe (Redis · Valkey · Dragonfly · KeyDB).
 */

import { credEnv } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Redis-protocol servers. */
export const redis: ImageRecipe = {
  id: "redis",
  port: 6379,
  match: (i) => /redis|valkey|dragonfly|keydb/i.test(i),
  apply: (s) => ({
    command: ["redis-server", "--requirepass", credEnv(s, "PASSWORD")],
    healthcheck: { test: ["CMD", "redis-cli", "-a", credEnv(s, "PASSWORD"), "ping"], interval: "5s", timeout: "3s", retries: 10 },
  }),
  url: (_s, c) => `redis://:${encodeURIComponent(c.password)}@${c.host}:${c.port}`,
};
