import { z } from "zod";

export const OrderRef = z.object({ orderId: z.string() });
