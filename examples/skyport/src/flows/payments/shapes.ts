import { z } from "zod";

export const ChargeIn = z.object({
  orderId: z.string(),
});
