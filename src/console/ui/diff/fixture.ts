/**
 * Manifest Diff fixtures for unit tests and the axe gate (console §9.12).
 */

import type { DiffListResponse } from "./types.ts";

/** Fixture with all four categories + CI gate distinction. */
export const DIFF_LIST_FIXTURE: DiffListResponse = {
  hasBaseline: true,
  severity: "contract-breaking",
  blockedCount: 1,
  acknowledgedCount: 1,
  changes: [
    {
      path: "/flows/reports.export/in",
      category: "contract-breaking",
      kind: "changed",
      summary: "in schema contract broke",
      flowName: "reports.export",
      runCountLastWeek: 1200,
      blastLine: null,
      weeklyDeltaUsd: null,
      weeklyBillLine: null,
      ciGate: "blocked",
    },
    {
      path: "/flows/legacy.import/trigger",
      category: "contract-breaking",
      kind: "changed",
      summary: "trigger changed",
      flowName: "legacy.import",
      runCountLastWeek: 40,
      blastLine: null,
      weeklyDeltaUsd: null,
      weeklyBillLine: null,
      ciGate: "acknowledged",
    },
    {
      path: "/flows/reports.export/gates",
      category: "permission-widening",
      kind: "changed",
      summary: "gate removed: staff",
      flowName: "reports.export",
      runCountLastWeek: 1200,
      blastLine: null,
      weeklyDeltaUsd: null,
      weeklyBillLine: null,
      ciGate: null,
    },
    {
      path: "/flows/orders.notify/effects/sends",
      category: "effect-widening",
      kind: "added",
      summary: "sends added: order-shipped",
      flowName: "orders.notify",
      runCountLastWeek: 41_208,
      blastLine:
        "this flow ran 41,208 times last week, it sent nothing, and it will now email every caller",
      weeklyDeltaUsd: 4.1208,
      weeklyBillLine: "+$4 per week",
      ciGate: null,
    },
    {
      path: "/flows/health.ping/source",
      category: "no-impact",
      kind: "changed",
      summary: "source changed",
      flowName: "health.ping",
      runCountLastWeek: 90_000,
      blastLine: null,
      weeklyDeltaUsd: null,
      weeklyBillLine: null,
      ciGate: null,
    },
  ],
};

/** Empty baseline fixture. */
export const DIFF_EMPTY_BASELINE_FIXTURE: DiffListResponse = {
  hasBaseline: false,
  severity: null,
  blockedCount: 0,
  acknowledgedCount: 0,
  changes: [],
};
