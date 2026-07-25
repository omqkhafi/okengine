/**
 * Runs fixtures for unit tests and the axe gate (console §9.11).
 *
 * Population volume for outlier explanation reuses Prompt 14's
 * {@link seedOutlierDataset}; a small multi-span chain covers Traces cross-links.
 */

import { seedOutlierDataset } from "../../../runs/outlier.ts";
import { rowToRun } from "./project.ts";
import type { RunRecord } from "./types.ts";

const T0 = 1_700_000_000_000;

/**
 * Compact multi-span chain + a few named runs for UI / a11y tests.
 */
export const RUNS_CHAIN_FIXTURE: readonly RunRecord[] = [
  rowToRun({
    id: "run-create-ok",
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: "org_a41",
    principal: "user_1",
    gates: ["member"],
    cache: "hit",
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
    ],
    logs: [
      {
        level: "info",
        message: "booking started",
        at: T0 + 1,
      },
    ],
    dimensions: {
      flow: "bookings.create",
      unit: "bookings",
      cache: "hit",
      tenant: "org_a41",
      duration_ms: 45,
    },
  }),
  rowToRun({
    id: "run-fulfill",
    parentId: "run-create-ok",
    flow: "fulfillment.onOrder",
    unit: "fulfillment",
    trigger: "signal",
    plane: "user",
    tenant: "org_a41",
    principal: "user_1",
    gates: [],
    cache: "none",
    startedAt: T0 + 7 * 24 * 60 * 60 * 1000,
    endedAt: T0 + 7 * 24 * 60 * 60 * 1000 + 120,
    durationMs: 120,
    effects: [
      {
        kind: "send",
        resource: "booking-confirmed",
        timestamp: T0 + 7 * 24 * 60 * 60 * 1000 + 40,
        duration: 60,
        reversibility: "irreversible",
      },
    ],
    logs: [],
    dimensions: {
      flow: "fulfillment.onOrder",
      unit: "fulfillment",
      cache: "none",
      tenant: "org_a41",
      duration_ms: 120,
    },
  }),
  rowToRun({
    id: "run-create-fail",
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: "org_b12",
    principal: "user_2",
    gates: ["member"],
    cache: "miss",
    replica: "replica",
    replicaLagMs: 240,
    startedAt: T0 + 1_000,
    endedAt: T0 + 1_028,
    durationMs: 28,
    error: "FlightFull",
    effects: [
      {
        kind: "read",
        resource: "sql:bookings",
        timestamp: T0 + 1_002,
        duration: 18,
        reversibility: "none",
      },
    ],
    logs: [
      {
        level: "warn",
        message: "flight full",
        data: { code: "FlightFull" },
        at: T0 + 1_020,
      },
    ],
    dimensions: {
      flow: "bookings.create",
      unit: "bookings",
      cache: "miss",
      tenant: "org_b12",
      error_code: "FlightFull",
      replica: "replica",
      replica_lag_ms: 240,
      duration_ms: 28,
    },
  }),
];

/**
 * Large seeded population where cache=miss cleanly separates slow runs.
 * Used for outlier-explanation unit tests.
 */
export function runsOutlierFixture(): RunRecord[] {
  return seedOutlierDataset({
    n: 400,
    slowShare: 0.12,
    separatingDimension: "cache",
    separatingValue: "miss",
    slowDurationMs: 2000,
    fastDurationMs: 40,
  }).map((e) =>
    rowToRun({
      id: e.id,
      parentId: e.parentId ?? null,
      flow: e.flow,
      unit: e.unit ?? null,
      trigger: e.trigger,
      plane: e.plane,
      tenant: e.tenant ?? null,
      principal: e.principal ?? null,
      gates: e.gates,
      cache: e.cache,
      replica: e.replica ?? null,
      replicaLagMs: e.replicaLagMs ?? null,
      cost: e.cost ?? null,
      promptVersion: e.promptVersion ?? null,
      buildVersion: e.buildVersion ?? null,
      startedAt: e.startedAt,
      endedAt: e.endedAt,
      durationMs: e.durationMs,
      error: e.error?.code ?? null,
      effects: e.effects.map((x) => ({
        kind: x.kind,
        resource: x.resource,
        timestamp: x.timestamp,
        duration: x.duration,
        reversibility: x.reversibility,
      })),
      logs: e.logs,
      dimensions: Object.fromEntries(
        Object.entries(e.dimensions).filter(([, v]) => v !== undefined),
      ) as Record<string, string | number | boolean | null>,
    }),
  );
}

/** Epoch origin used by {@link RUNS_CHAIN_FIXTURE}. */
export const RUNS_FIXTURE_T0 = T0;
