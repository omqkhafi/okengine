/**
 * Dragonfly image recipe — Redis-wire-compatible, multi-threaded alternative.
 *
 * Peer of Redis / Valkey via `images["store.kv"]` (driver id stays `redis`).
 * Official image: `docker.dragonflydb.io/dragonflydb/dragonfly`.
 */

import type { ImageRecipe } from "../types.ts";

/** Dragonfly — Redis protocol on 6379. */
export const dragonfly: ImageRecipe = {
  id: "dragonfly",
  port: 6379,
  match: (i) => /dragonfly/i.test(i),
  apply: () => ({
    environment: { HEALTHCHECK_PORT: "6379" },
    command: [
      "sh",
      "-c",
      'exec dragonfly --requirepass "$$OKE_STORE_KV_PASSWORD" --maxmemory "$${OKE_STORE_KV_MAXMEMORY:-0}"',
    ],
    ulimits: { memlock: -1 },
    healthcheck: {
      test: ["CMD", "/usr/local/bin/healthcheck.sh"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
    },
  }),
  url: (_s, c) => `redis://:${encodeURIComponent(c.password)}@${c.host}:${c.port}`,
};
