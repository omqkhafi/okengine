/**
 * Overview fixtures for unit tests and the axe gate (console §9.16).
 */

import type { Manifest } from "../../../manifest/types.ts";
import { AI_LIST_FIXTURE } from "../ai/fixture.ts";
import { ARCHITECTURE_TEST_MANIFEST } from "../architecture/fixture.ts";
import { CHANNELS_LIST_FIXTURE } from "../channels/fixture.ts";
import { CLOCK_LIST_FIXTURE } from "../clock/fixture.ts";
import { DIFF_LIST_FIXTURE } from "../diff/fixture.ts";
import { GATES_LIST_FIXTURE } from "../gates/fixture.ts";
import { rowToRun } from "../runs/project.ts";
import type { RunRecord } from "../runs/types.ts";
import { SIGNALS_FIXTURE } from "../signals/fixture.ts";
import { VAULT_LIST_FIXTURE } from "../vault/fixture.ts";
import type { OverviewInputs } from "./compose.ts";

/** Fixed clock for deterministic burn / ceremonial math. */
export const OVERVIEW_NOW = 1_700_000_000_000;

/** Manifest with flow + journey SLOs and a cost budget. */
export const OVERVIEW_MANIFEST: Manifest = {
  ...ARCHITECTURE_TEST_MANIFEST,
  app: "skyport-overview-test",
  flows: {
    ...ARCHITECTURE_TEST_MANIFEST.flows,
    "bookings.create": {
      ...(ARCHITECTURE_TEST_MANIFEST.flows?.["bookings.create"] ?? {
        plane: "user",
        gates: ["member"],
      }),
      slo: { availability: "99.9%", latency: { p99: "200ms" } },
      cost: { budget: 10, estimatePerCall: 0.01 },
    },
  },
  journeys: {
    "book-a-flight": {
      slo: { availability: "99.5%" },
      flows: ["bookings.create"],
    },
  },
  plugins: {
    audit: {
      version: "1.0.0",
      declares: ["console.panel"],
      intercepts: ["afterHandle"],
    },
  },
};

/** Diff fixture with a plugin capability widening. */
export const OVERVIEW_DIFF_FIXTURE = {
  ...DIFF_LIST_FIXTURE,
  changes: [
    ...DIFF_LIST_FIXTURE.changes,
    {
      path: "/plugins/audit/intercepts",
      category: "permission-widening" as const,
      kind: "added" as const,
      summary: "plugin capabilities widened: intercepts afterHandle",
      flowName: null,
      runCountLastWeek: 0,
      blastLine: null,
      weeklyDeltaUsd: null,
      weeklyBillLine: null,
      ciGate: null,
    },
  ],
};

/** Vault list with one dormant secret (never read). */
export const OVERVIEW_VAULT_FIXTURE = {
  ...VAULT_LIST_FIXTURE,
  secrets: [
    ...VAULT_LIST_FIXTURE.secrets,
    {
      name: "LEGACY_WEBHOOK_SECRET",
      kind: "secret" as const,
      sensitive: true,
      fingerprints: { dev: "sha256:cccccccccccccccc" },
      fingerprint: "sha256:cccccccccccccccc",
      cleartext: null,
      winner: ".env.local" as const,
      resolution: [
        { source: "process.env" as const, present: false, won: false },
        { source: ".env.local" as const, present: true, won: true },
        { source: ".env.stack" as const, present: false, won: false },
        { source: "driver" as const, present: false, won: false },
        { source: "dev-fallback" as const, present: false, won: false },
      ],
      readers: [],
      blastRadius: {
        count: 0,
        longestWakeAt: null,
        longestOutstandingMs: null,
        runIds: [],
      },
      lastReadAt: null,
      sharedFingerprintEnvs: [],
    },
  ],
};

/**
 * Runs that burn bookings.create in the short window
 * (error rate ≫ 0.1% tolerable for 99.9%).
 */
export const OVERVIEW_BURN_RUNS: readonly RunRecord[] = Array.from(
  { length: 100 },
  (_, i) =>
    rowToRun({
      id: `burn-${i}`,
      flow: "bookings.create",
      unit: "bookings",
      trigger: "http",
      plane: "user",
      cache: "none",
      cost: 0.05,
      startedAt: OVERVIEW_NOW - 30 * 60_000 + i * 1_000,
      endedAt: OVERVIEW_NOW - 30 * 60_000 + i * 1_000 + 40,
      durationMs: 40,
      error: i < 20 ? "Timeout" : null,
      effects: [],
      logs: [],
      dimensions: {
        flow: "bookings.create",
        error_code: i < 20 ? "Timeout" : null,
      },
    }),
);

/** Full Overview inputs — burning SLO + multi-panel findings. */
export const OVERVIEW_INPUTS_FIXTURE: OverviewInputs = {
  manifest: OVERVIEW_MANIFEST,
  runs: OVERVIEW_BURN_RUNS,
  gates: GATES_LIST_FIXTURE,
  signals: SIGNALS_FIXTURE,
  clock: CLOCK_LIST_FIXTURE,
  vault: OVERVIEW_VAULT_FIXTURE,
  channels: CHANNELS_LIST_FIXTURE,
  ai: AI_LIST_FIXTURE,
  diff: OVERVIEW_DIFF_FIXTURE,
  now: OVERVIEW_NOW,
};

/** Day-one inputs — no SLOs declared. */
export const OVERVIEW_DAY_ONE_INPUTS: OverviewInputs = {
  ...OVERVIEW_INPUTS_FIXTURE,
  manifest: {
    ...OVERVIEW_MANIFEST,
    flows: Object.fromEntries(
      Object.entries(OVERVIEW_MANIFEST.flows ?? {}).map(([k, f]) => [
        k,
        { ...f, slo: undefined },
      ]),
    ),
    journeys: undefined,
  },
};
