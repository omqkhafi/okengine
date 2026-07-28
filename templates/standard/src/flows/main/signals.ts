import { signal } from "okengine";
import { z } from "zod";

/** Emitted by `create` — consumed once to send a channel notice. */
export const pinged = signal("pinged", {
  schema: z.object({
    id: z.string(),
    note: z.string(),
    at: z.number(),
  }),
  delivery: "once",
});
