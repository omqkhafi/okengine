import { on, flow, http } from "okengine";
import { z } from "zod";

import "./shapes";
import "./signals";

/** First-run welcome — visit :6530/ after `oke dev`. */
export const root = on(
  http.get("/"),
  flow({
    out: z.object({
      ok: z.literal(true),
      console: z.string(),
      try: z.string(),
    }),
    do: () => ({
      ok: true as const,
      console: "http://127.0.0.1:6533",
      try: "/health",
    }),
  }),
);

/** Replace with your unit's flows. */
export const health = on(
  http.get("/health"),
  flow({
    out: z.object({ ok: z.literal(true) }),
    do: () => ({ ok: true as const }),
  }),
);
