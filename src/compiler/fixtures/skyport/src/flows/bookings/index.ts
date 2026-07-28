import { on, flow, http } from "okengine";
import { eq } from "drizzle-orm";
import { db } from "../../core.ts";
import { member, canBook, fair } from "../../gates.ts";
import { bookings } from "../../schema.ts";
import { orderPlaced, seatFeed } from "./signals.ts";

const BookingIn = { name: "BookingIn" };
const BookingOut = { name: "BookingOut" };
const FlightFull = { name: "FlightFull" };

// Padding so `flow(` lands on line 18 (spec excerpt source path).
void 0;
void 0;

export const create = on(
  http.post("/bookings").gate(member, canBook, fair),
  flow({
    name: "bookings.create",
    in: BookingIn,
    out: BookingOut,
    errors: { FlightFull },
    slo: { availability: "99.9%", latency: { p99: "200ms" } },
    plane: "user",
    do: async (input, fx) => {
      const left = await fx.store(db).select().from(bookings);
      if (!left) return fx.fail("FlightFull", {});
      await fx.store(db).insert(bookings).values(input);
      await fx.emit(orderPlaced, { id: "1" });
      await fx.emit(seatFeed, {});
      return { id: fx.id() };
    },
  }),
);

export const mine = on(
  http.get("/bookings").gate(member).live(),
  flow({
    name: "bookings.mine",
    live: true,
    do: (_, fx) =>
      fx
        .store(db)
        .select()
        .from(bookings)
        .where(eq(bookings.userId as never, fx.auth.userId)),
  }),
);

export const getBooking = flow({
  name: "bookings.getBooking",
  do: ({ id }, fx) => fx.store(db).findById(bookings, id),
});

export const refundBooking = flow({
  name: "bookings.refundBooking",
  do: async ({ id }, fx) => {
    await fx.store(db).update(bookings).set({ status: "refunded" }).where({ id });
    return fx.store(db).findById(bookings, id);
  },
});
