/**
 * Manifest + Runs fixtures for Architecture panel tests (console §9.13).
 */

import type { Manifest } from "../../../manifest/types.ts";
import { FLOWS_TEST_MANIFEST } from "../flows/fixture.ts";
import { RUNS_CHAIN_FIXTURE } from "../runs/fixture.ts";
import type { RunRecord } from "../runs/types.ts";

/**
 * Architecture fixture — extends the Flows causality slice with a cycle,
 * an orphan signal, a cron (time layer), and a cross-unit call.
 */
export const ARCHITECTURE_TEST_MANIFEST: Manifest = {
  ...FLOWS_TEST_MANIFEST,
  app: "skyport-architecture-test",
  flows: {
    ...FLOWS_TEST_MANIFEST.flows,
    "ops.nightlyReconcile": {
      trigger: { cron: "0 3 * * *" },
      effects: {
        reads: ["sql:bookings"],
        writes: ["sql:bookings"],
      },
      source: "src/flows/ops/index.ts:8",
    },
    "ops.pingPayments": {
      effects: {
        calls: ["payments.reportToOps"],
      },
      source: "src/flows/ops/index.ts:20",
    },
    "payments.reportToOps": {
      effects: {
        calls: ["ops.pingPayments"],
        emits: ["payment-reported"],
      },
      source: "src/flows/payments/index.ts:40",
    },
    "reports.onPayment": {
      trigger: { signal: "payment-reported" },
      effects: {
        writes: ["sql:reports"],
      },
      source: "src/flows/reports/index.ts:4",
    },
    "reports.list": {
      trigger: { http: { method: "GET", path: "/reports" } },
      effects: {
        reads: ["sql:reports"],
      },
      source: "src/flows/reports/index.ts:18",
    },
  },
  signals: {
    ...FLOWS_TEST_MANIFEST.signals,
    "payment-reported": { delivery: "once", retries: 3, deadLetter: true },
    /** Declared, never emitted, never consumed. */
    "legacy-unused": { delivery: "once", retries: 1, deadLetter: false },
  },
  stores: {
    db: {
      facet: "sql",
      tables: {
        bookings: {},
        shipments: {},
        reports: {},
      },
    },
  },
};

/** Runs fixture reused for traffic thickness / dashed edges. */
export const ARCHITECTURE_RUNS_FIXTURE: readonly RunRecord[] = RUNS_CHAIN_FIXTURE;
