import { on, flow, http, every } from "okengine";
import { z } from "zod";
import { open } from "../../gates";
import { Health } from "./shapes";
import { pinged } from "./signals";

/** First-run welcome — visit :6530/ after `oke dev`. */
export const root = on(
  http.get("/").gate(open),
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

export const health = on(
  http.get("/health").gate(open),
  flow({
    out: Health,
    do: async (_input, fx) => {
      await fx.emit(pinged, { at: Date.now() });
      return { ok: true as const };
    },
  }),
);

on(pinged, flow({
  do: async () => {},
}));

/** Trivial cron — replace with real schedules. */
on(
  every("1d"),
  flow({
    do: async () => {},
  }),
);
