import { signal } from "okengine";
import { z } from "zod";

export const linkClicked = signal("link-clicked", {
  schema: z.object({ code: z.string(), at: z.number(), referrer: z.string().optional() }),
  delivery: "once",                       // queue physics: one consumer, retries, DLQ
  retries: 3, deadLetter: true,
});

export const linkStats = signal("link-stats", {
  schema: z.object({ code: z.string(), clicks: z.number() }),
  delivery: "live",                       // stream physics: clients subscribe
});
