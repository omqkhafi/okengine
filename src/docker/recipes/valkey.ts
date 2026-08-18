/**
 * Valkey image recipe — Redis-wire-compatible (BSD-3-Clause, Linux Foundation).
 *
 * Opt-in via `images["store.kv"]` (driver id stays `redis`). Official image:
 * `valkey/valkey`.
 */

import { credEnv, kvServerCommand } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Valkey — Redis protocol on 6379. */
export const valkey: ImageRecipe = {
  id: "valkey",
  port: 6379,
  match: (i) => /valkey/i.test(i),
  apply: (s) => ({
    command: ["sh", "-c", kvServerCommand(s, "valkey-server")],
    healthcheck: {
      test: ["CMD", "valkey-cli", "-a", credEnv(s, "PASSWORD"), "ping"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
    },
  }),
  url: (_s, c) => `redis://:${encodeURIComponent(c.password)}@${c.host}:${c.port}`,
};
