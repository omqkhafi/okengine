import { on, flow, http } from "okengine";
import { db } from "../../core";
import { member, canBook, fair } from "../../gates";
import { bookings } from "../../schema";
import { orderPlaced, seatFeed } from "./signals";
import { BookingIn, BookingOut, FlightFull } from "./shapes";

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
      const id = fx.id();
      await fx.store(db).insert(bookings).values({
        id,
        userId: input.userId ?? fx.auth.userId ?? "anon",
        flight: input.flight,
        status: "held",
      });
      await fx.emit(orderPlaced, { id });
      await fx.emit(seatFeed, {});
      return { id };
    },
  }),
);

export const mine = on(
  http.get("/bookings").gate(member).live(),
  flow({
    name: "bookings.mine",
    live: true,
    do: (_, fx) =>
      fx.store(db).select().from(bookings).where({ userId: fx.auth.userId }),
  }),
);

export const getBooking = flow({
  name: "bookings.getBooking",
  do: ({ id }, fx) => fx.store(db).findById(bookings, id as string),
});

export const refundBooking = flow({
  name: "bookings.refundBooking",
  do: ({ id }, fx) =>
    fx.store(db).setStatus(bookings, id as string, "refunded"),
});
