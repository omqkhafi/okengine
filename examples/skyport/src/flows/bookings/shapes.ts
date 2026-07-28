import { z } from "zod";

export const NewBooking = z.object({ flightId: z.string(), seats: z.number().min(1).max(9) });
export const BookingId = z.object({ id: z.string() });
export const BookingRow = z.object({ id: z.string(), status: z.string(), seats: z.number() });
export const FlightFull = z.object({ seatsLeft: z.number() });
