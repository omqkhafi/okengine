import { on, flow, http } from "okengine";
import { z } from "zod";

import "./shapes";
import "./signals";

/** Replace with your unit's flows. */
export const health = on(
  http.get("/health"),
  flow({
    out: z.object({ ok: z.literal(true) }),
    do: () => ({ ok: true as const }),
  }),
);
