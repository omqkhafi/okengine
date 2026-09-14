import { on, flow, http } from "okengine/http";

import { HealthOut } from "./shapes";

/**
 * Liveness for probes and `bun test`.
 *
 * Public, no gate — `GET /health` must stay reachable for compose / CI.
 */
export const health = on(
  http.get({ out: HealthOut }).public(),
  flow({ do: () => ({ ok: true as const }) }),
);
