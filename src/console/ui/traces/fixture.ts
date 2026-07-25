/**
 * Trace fixtures for unit tests and the axe gate (console §9.3).
 */

import type { TraceSpan } from "./types.ts";

const T0 = 1_700_000_000_000;

/**
 * Causal chain: bookings.create → (7d sleep) → fulfillment.onOrder (email) ·
 * plus a failed sibling bookings.create with FlightFull.
 */
export const TRACES_FIXTURE: readonly TraceSpan[] = [
  {
    id: "run-create-ok",
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    startedAt: T0,
    endedAt: T0 + 45,
    durationMs: 45,
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: T0 + 2,
        duration: 8,
        reversibility: "none",
      },
      {
        kind: "write",
        resource: "sql:bookings",
        timestamp: T0 + 12,
        duration: 15,
        reversibility: "reversible",
      },
      {
        kind: "emit",
        resource: "order-placed",
        timestamp: T0 + 30,
        duration: 4,
        reversibility: "deferred",
      },
    ],
    sampled: "sample",
  },
  {
    id: "run-fulfill",
    parentId: "run-create-ok",
    flow: "fulfillment.onOrder",
    unit: "fulfillment",
    trigger: "signal",
    // 7-day sleep between emit and consume (folded time).
    startedAt: T0 + 7 * 24 * 60 * 60 * 1000,
    endedAt: T0 + 7 * 24 * 60 * 60 * 1000 + 120,
    durationMs: 120,
    effects: [
      {
        kind: "write",
        resource: "sql:shipments",
        timestamp: T0 + 7 * 24 * 60 * 60 * 1000 + 10,
        duration: 20,
        reversibility: "reversible",
      },
      {
        kind: "send",
        resource: "booking-confirmed",
        timestamp: T0 + 7 * 24 * 60 * 60 * 1000 + 40,
        duration: 60,
        reversibility: "irreversible",
      },
    ],
    cost: 0,
    sampled: "full",
  },
  {
    id: "run-create-fail",
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    startedAt: T0 + 1_000,
    endedAt: T0 + 1_028,
    durationMs: 28,
    errorCode: "FlightFull",
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: T0 + 1_002,
        duration: 18,
        reversibility: "none",
      },
    ],
    sampled: "error",
  },
  {
    id: "run-ask",
    flow: "support.triage",
    unit: "support",
    trigger: "http",
    startedAt: T0 + 2_000,
    endedAt: T0 + 2_400,
    durationMs: 400,
    effects: [
      {
        kind: "secret",
        resource: "OPENAI_KEY",
        timestamp: T0 + 2_010,
        duration: 2,
        reversibility: "capability",
      },
      {
        kind: "ask",
        resource: "triage@3",
        timestamp: T0 + 2_020,
        duration: 350,
        reversibility: "irreversible",
      },
    ],
    cost: 0.08,
    sampled: "sample",
  },
];

/** Epoch origin used by {@link TRACES_FIXTURE}. */
export const TRACES_FIXTURE_T0 = T0;
