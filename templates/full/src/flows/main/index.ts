import { on, flow, http, every } from "okengine";
import { open } from "../../gates";
import { Health } from "./shapes";
import { pinged } from "./signals";

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
