/**
 * Redis image recipe — default `store.kv` pin (`redis:*`).
 *
 * Valkey and Dragonfly are separate recipes — same `redis` driver /
 * `redis://` URL, different binaries. Pin via `images["store.kv"]`.
 */

import { credEnv, kvServerCommand } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Redis Open Source — Redis protocol on 6379. */
export const redis: ImageRecipe = {
  id: "redis",
  port: 6379,
  match: (i) => /(?:^|\/)redis(?:[:@/]|$)/i.test(i) || /keydb/i.test(i),
  apply: (s) => ({
    command: ["sh", "-c", kvServerCommand(s, "redis-server")],
    healthcheck: {
      test: ["CMD", "redis-cli", "-a", credEnv(s, "PASSWORD"), "ping"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
    },
  }),
  url: (_s, c) => `redis://:${encodeURIComponent(c.password)}@${c.host}:${c.port}`,
};
