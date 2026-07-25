import { signal } from "okengine";
import { z } from "zod";

export const orderPlaced = signal("order-placed", {
  delivery: "once",
  schema: z.object({ id: z.string() }),
});

export const seatFeed = signal("seat-feed", {
  delivery: "live",
  schema: z.object({}).passthrough(),
});
