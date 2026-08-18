/**
 * Dragonfly image recipe — Redis-wire-compatible, multi-threaded alternative.
 *
 * Peer of Redis / Valkey via `images["store.kv"]` (driver id stays `redis`).
 * Official image: `docker.dragonflydb.io/dragonflydb/dragonfly`.
 * Durable role: snapshot persistence (`--dir` / `--dbfilename` / cron) — not AOF.
 */

import { dragonflyServerCommand, durableKvVolume } from "../helpers.ts";
import type { ImageRecipe } from "../types.ts";

/** Dragonfly — Redis protocol on 6379. */
export const dragonfly: ImageRecipe = {
  id: "dragonfly",
  port: 6379,
  match: (i) => /dragonfly/i.test(i),
  apply: (s) => ({
    environment: { HEALTHCHECK_PORT: "6379" },
    command: ["sh", "-c", dragonflyServerCommand(s)],
    ulimits: { memlock: -1 },
    healthcheck: {
      test: ["CMD", "/usr/local/bin/healthcheck.sh"],
      interval: "5s",
      timeout: "3s",
      retries: 10,
    },
    ...(durableKvVolume(s).length > 0 ? { volumes: durableKvVolume(s) } : {}),
  }),
  url: (_s, c) => `redis://:${encodeURIComponent(c.password)}@${c.host}:${c.port}`,
};
