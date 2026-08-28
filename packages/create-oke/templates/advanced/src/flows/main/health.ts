import { on, flow, http } from "okengine/http";

/** Liveness for probes and `bun test`. */
export const health = on(
  http.get().public(),
  flow({ do: () => ({ ok: true }) }),
);
