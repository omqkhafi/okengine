import { signal } from "okengine";
import { z } from "zod";

/** Trivial signal — replace with real events. */
export const pinged = signal("pinged", {
  schema: z.object({ at: z.number() }),
  delivery: "once",
});
