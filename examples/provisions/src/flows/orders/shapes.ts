import { z } from "zod";

export const NewOrder = z.object({
  sku: z.string().min(1),
  qty: z.number().int().positive(),
});

export const OrderId = z.object({ id: z.string() });

export const OrderRow = z.object({
  id: z.string(),
  userId: z.string(),
  sku: z.string(),
  qty: z.number(),
  status: z.string(),
  total: z.number().optional(),
});

export const OutOfStock = z.object({ left: z.number() });
