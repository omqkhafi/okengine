import { z } from "zod";

export const BookingIn = z.object({
  flight: z.string(),
  userId: z.string().optional(),
});

export const BookingOut = z.object({
  id: z.string(),
});

export const FlightFull = z.object({
  reason: z.string().optional(),
});
