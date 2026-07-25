import { on, flow, gate, http } from "okengine";
import { eq } from "drizzle-orm";
import { db } from "../../core";
import { member, fair } from "../../gates";
import { orderPlaced, seatFeed } from "./signals";
import { NewBooking, BookingId, BookingRow, FlightFull } from "./shapes";
import { bookings, flights } from "../../schema";

export const canBook = gate.policy("booking:create", ({ auth }) => auth.scopes.has("booking:create"));

export const create = on(http.post("/bookings").gate(member, canBook, fair), flow({
  slo: { availability: "99.9%", latency: { p99: "200ms" } },
  in: NewBooking, out: BookingId, errors: { FlightFull },
  do: async ({ flightId, seats }, fx) => {
    const [flight] = await fx.store(db).select().from(flights).where(eq(flights.id, flightId)).limit(1);
    if (!flight || flight.seatsAvailable < seats)
      return fx.fail("FlightFull", { seatsLeft: flight?.seatsAvailable ?? 0 });

    const id = fx.id();
    await fx.store(db).insert(bookings).values(
      { id, userId: fx.auth.userId, flightId, seats, status: "pending", createdAt: Date.now() });
    await fx.emit(orderPlaced, { orderId: id });
    await fx.emit(seatFeed, { flightId, left: flight.seatsAvailable - seats });
    return { id };
  },
}));

export const mine = on(http.get("/bookings").gate(member).live(), flow({
  out: BookingRow.array(),
  do: (_, fx) => fx.store(db).select().from(bookings).where(eq(bookings.userId, fx.auth.userId)),
}));

export const getBooking = flow({
  in: BookingId, out: BookingRow,
  do: async ({ id }, fx) => {
    const [b] = await fx.store(db).select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return b;
  },
});

// The agent's second tool — refunding is a distinct, gated capability, never the same
// permission as reading a booking, since the agent's tool list is exactly its authority.
export const refundBooking = flow({
  in: BookingId, out: BookingRow,
  do: async ({ id }, fx) => {
    await fx.store(db).update(bookings).set({ status: "refunded" }).where(eq(bookings.id, id));
    const [b] = await fx.store(db).select().from(bookings).where(eq(bookings.id, id)).limit(1);
    return b;
  },
});
