/**
 * AI panel fixtures for unit tests and the axe gate (console §9.10).
 */

import type { AiListResponse, PromptVersionMetrics } from "./types.ts";

function dist(samples: readonly number[]): PromptVersionMetrics["cost"] {
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.length === 0 ? 0 : sorted.reduce((a, b) => a + b, 0) / sorted.length;
  const p50 = sorted[Math.floor(sorted.length * 0.5)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? p50;
  const min = sorted[0] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return {
    samples: sorted,
    mean,
    p50,
    p95,
    buckets:
      sorted.length === 0
        ? []
        : [
            { min, max: min + (max - min) / 2 || min + 0.001, count: Math.ceil(sorted.length / 2) },
            {
              min: min + (max - min) / 2 || min + 0.001,
              max: max + 0.0001,
              count: Math.floor(sorted.length / 2),
            },
          ],
  };
}

/** Baseline v2 — healthy. */
export const VERSION_V2: PromptVersionMetrics = {
  prompt: "ticket-triage",
  version: 2,
  sampleCount: 100,
  cost: dist([0.008, 0.009, 0.01, 0.011, 0.012]),
  latencyMs: dist([120, 140, 160, 180, 200]),
  evalScore: dist([0.82, 0.84, 0.85, 0.86, 0.88]),
  schemaInvalidRate: 0.02,
  providerErrorRate: 0.01,
  okRate: 0.97,
  overBudgetRate: 0.0,
  budgetMaxCostPerCall: 0.02,
  outcomeCounts: { ok: 97, provider_error: 1, schema_invalid: 2 },
};

/** Candidate v3 — higher eval, worse schema + budget. */
export const VERSION_V3: PromptVersionMetrics = {
  prompt: "ticket-triage",
  version: 3,
  sampleCount: 100,
  cost: dist([0.015, 0.018, 0.022, 0.025, 0.03]),
  latencyMs: dist([150, 170, 190, 220, 250]),
  evalScore: dist([0.9, 0.91, 0.92, 0.93, 0.94]),
  schemaInvalidRate: 0.086,
  providerErrorRate: 0.01,
  okRate: 0.904,
  overBudgetRate: 0.12,
  budgetMaxCostPerCall: 0.02,
  outcomeCounts: { ok: 90, provider_error: 1, schema_invalid: 9 },
};

/** Full AI list fixture. */
export const AI_LIST_FIXTURE: AiListResponse = {
  prompts: [
    {
      name: "ticket-triage",
      version: 3,
      model: "smart",
      evals: "./evals/triage.jsonl",
      budgetMaxCostPerCall: 0.02,
      manifestDiffPath: "/ai/prompts/ticket-triage/version",
    },
  ],
  agents: [
    {
      name: "support",
      tools: ["bookings.getBooking", "bookings.refundBooking"],
      maxSteps: 6,
      model: "smart",
      budgetMaxCostPerRun: 0.25,
    },
  ],
  versions: [VERSION_V2, VERSION_V3],
  allowPii: [
    {
      flowId: "support.createTicket",
      asks: ["ticket-triage"],
      pii: "allow",
      allowPii: true,
      source: "src/flows/support/index.ts",
    },
  ],
  fallbackChains: [
    {
      prompt: "ticket-triage",
      version: 3,
      attempts: [
        {
          model: "smart",
          ok: false,
          error: "timeout",
          cost: 0,
          latencyMs: 800,
          at: 1_700_000_000_000,
        },
        {
          model: "fast",
          ok: true,
          cost: 0.004,
          latencyMs: 90,
          at: 1_700_000_000_100,
        },
      ],
      actualCost: 0.004,
      primaryOnlyCost: null,
      costConsequence: 0.004,
      at: 1_700_000_000_100,
    },
  ],
  agentRuns: [
    {
      id: "agent-run-1",
      agent: "support",
      message: "refund booking B1",
      ok: false,
      steps: 2,
      cost: 0,
      at: 1_700_000_000_200,
      trail: [
        {
          tool: "bookings.getBooking",
          status: "ok",
          effects: [{ kind: "read", resource: "sql:bookings" }],
          denial: null,
          at: 1_700_000_000_210,
        },
        {
          tool: "bookings.refundBooking",
          status: "denied",
          effects: [
            { kind: "write", resource: "sql:bookings" },
            { kind: "send", resource: "refund-notice" },
          ],
          denial: {
            agent: "support",
            tool: "bookings.refundBooking",
            gate: "member",
            reason: "not verified",
            at: 1_700_000_000_220,
          },
          at: 1_700_000_000_220,
        },
      ],
      denials: [
        {
          agent: "support",
          tool: "bookings.refundBooking",
          gate: "member",
          reason: "not verified",
          at: 1_700_000_000_220,
        },
      ],
    },
  ],
  denials: [
    {
      agent: "support",
      tool: "bookings.refundBooking",
      gate: "member",
      reason: "not verified",
      at: 1_700_000_000_220,
    },
  ],
};
