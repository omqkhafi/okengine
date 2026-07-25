import { signal } from "okengine";
import { z } from "zod";

export const orderPlaced = signal("order-placed", {
  schema: z.object({ orderId: z.string() }),
  delivery: "once",
  retries: 3,
  deadLetter: true,
});

export const orderNews = signal("order-news", {
  schema: z.object({
    orderId: z.string(),
    status: z.enum(["confirmed", "failed"]),
  }),
  delivery: "once",
  retries: 3,
  deadLetter: true,
});
