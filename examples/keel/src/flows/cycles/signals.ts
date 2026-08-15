import { signal } from "okengine";
import { z } from "zod";

/** Cycle completed — rollover leftovers. */
export const cycleClosed = signal("cycle-closed", {
  delivery: "broadcast",
  retries: 3,
  deadLetter: true,
  schema: z.object({
    cycleId: z.string(),
    leftover: z.number(),
    name: z.string(),
    summary: z.string(),
  }),
});
