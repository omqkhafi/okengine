/**
 * Minimal Manifest fixture for Flows panel unit tests.
 */

import type { Manifest } from "../../../manifest/types.ts";

/** Skyport-shaped slice covering causality traversal. */
export const FLOWS_TEST_MANIFEST: Manifest = {
  oke: "1.0",
  app: "skyport-flows-test",
  flows: {
    "bookings.create": {
      trigger: { http: { method: "POST", path: "/bookings" } },
      in: {
        type: "object",
        required: ["flightId", "seats"],
        properties: {
          flightId: { type: "string" },
          seats: { type: "integer", minimum: 1, maximum: 9 },
          cabin: {
            type: "string",
            enum: ["economy", "business"],
          },
        },
      },
      out: {
        type: "object",
        required: ["id"],
        properties: { id: { type: "string" } },
      },
      errors: ["FlightFull"],
      effects: {
        reads: ["sql:bookings"],
        writes: ["sql:bookings"],
        emits: ["order-placed"],
      },
      plane: "user",
      source: "src/flows/bookings/index.ts:18",
    },
    "bookings.mine": {
      trigger: { http: { method: "GET", path: "/bookings" } },
      live: true,
      effects: { reads: ["sql:bookings"] },
      source: "src/flows/bookings/index.ts:42",
    },
    "fulfillment.onOrder": {
      trigger: { signal: "order-placed" },
      effects: {
        writes: ["sql:shipments"],
        sends: ["booking-confirmed"],
      },
      source: "src/flows/fulfillment/index.ts:4",
    },
    "payments.chargeBooking": {
      durable: true,
      effects: {
        secrets: ["STRIPE_KEY"],
        calls: ["bookings.create"],
      },
      source: "src/flows/payments/index.ts:12",
    },
  },
  signals: {
    "order-placed": { delivery: "once", retries: 5, deadLetter: true },
  },
  stores: {
    db: {
      facet: "sql",
      tables: {
        bookings: {},
        shipments: {},
      },
    },
  },
  channels: {
    "booking-confirmed": { medium: "email", locales: ["en"] },
  },
  vault: {
    STRIPE_KEY: { description: "Payments key", rotate: "90d" },
  },
};
