import { on, flow, http } from "okengine";
import { z } from "zod";

/** Liveness for probes and `bun test`. */
export const health = on(
  http.get().public(),
  flow({
    out: z.object({ ok: z.literal(true) }),
    do: () => ({ ok: true as const }),
  }),
);
