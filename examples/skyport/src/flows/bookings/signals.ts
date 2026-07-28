import { signal } from "okengine";
import { z } from "zod";

export const orderPlaced = signal("order-placed", {
  schema: z.object({ orderId: z.string() }),
  delivery: "once",
  retries: 5,
  deadLetter: true,
});
export const seatFeed = signal("seat-feed", {
  schema: z.object({ flightId: z.string(), left: z.number() }),
  delivery: "live",
});
