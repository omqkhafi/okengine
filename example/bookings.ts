/**
 * Example — typed POST /bookings with Standard Schema validation.
 *
 * Run: `bun run example`
 */

import { z } from "zod";
import {
  APP_PORT,
  createBunRuntime,
  flow,
  http,
  oke,
  on,
} from "../src/index.ts";

const BookingIn = z.object({
  flightId: z.string().min(1),
  seats: z.number().int().min(1).max(9),
});

const BookingOut = z.object({
  id: z.string(),
  flightId: z.string(),
  seats: z.number(),
});

const FlightFull = z.object({
  seatsLeft: z.number().int(),
});

on(
  http.post("/bookings"),
  flow({
    name: "bookings.create",
    in: BookingIn,
    out: BookingOut,
    errors: { FlightFull },
    do: (input: z.infer<typeof BookingIn>, fx) => {
      if (input.seats > 2) {
        return fx.fail("FlightFull", { seatsLeft: 2 });
      }
      return {
        id: fx.id(),
        flightId: input.flightId,
        seats: input.seats,
      };
    },
  }),
);

const app = oke({ name: "bookings-example" });
const runtime = createBunRuntime();
const port = Number(process.env.PORT ?? APP_PORT);

const server = runtime.serve(app, { port, hostname: "127.0.0.1" });

console.log(`okengine example listening on http://127.0.0.1:${server.port}`);
console.log(`POST /bookings  { "flightId": "SK1", "seats": 1 }`);
console.log(`typed errors: ValidationError (422) · FlightFull (400)`);
