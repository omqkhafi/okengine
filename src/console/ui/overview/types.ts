/**
 * Overview panel domain types (console §9.16).
 *
 * Pure aggregator — every finding originates in another panel.
 */

import type { DiffCategory } from "../diff/types.ts";

/** Panel that produced a finding. */
export type FindingSource =
  | "gates"
  | "signals"
  | "clock"
  | "vault"
  | "channels"
  | "architecture"
  | "plugins"
  | "ai"
  | "access";

/**
 * One ranked finding in the Overview union.
 *
 * Ranking keys: user harm → irreversibility → trend (higher = worse).
 */
export interface OverviewFinding {
  readonly id: string;
  readonly source: FindingSource;
  readonly title: string;
  readonly detail: string;
  readonly href: string;
  readonly userHarm: number;
  readonly irreversibility: number;
  readonly trend: number;
}

/** Flow- or journey-level SLO with live burn. */
export interface SloBurn {
  readonly id: string;
  readonly kind: "flow" | "journey";
  readonly name: string;
  /** Declared availability string from the Manifest (e.g. `99.9%`). */
  readonly availability: string;
  /** Tolerable error rate derived from availability (never invented). */
  readonly tolerableErrorRate: number;
  /** Current error rate from real Runs. */
  readonly currentErrorRate: number;
  /** `currentErrorRate / tolerableErrorRate`. */
  readonly burnRate: number;
  /** Remaining error-budget fraction in the long window (0–1). */
  readonly remainingBudgetFraction: number;
  /** Projected ms until budget exhaustion, or null when not burning. */
  readonly timeToExhaustionMs: number | null;
  /** True when burn rate never reached 1× in the last 90 days. */
  readonly ceremonial: boolean;
  /** Last epoch-ms when burn rate ≥ 1, or null. */
  readonly lastBurnAt: number | null;
  readonly sampleCount: number;
  readonly errorCount: number;
  /** Observed p95 latency ms in the short window (0 when empty). */
  readonly latencyP95Ms: number;
  /** Declared p95 threshold ms when Manifest sets `slo.latency.p95`. */
  readonly latencyP95ThresholdMs: number | null;
  /** True when observed p95 exceeds the declared threshold. */
  readonly latencyBreached: boolean;
}

/** Cost budget in the same visual model as the error budget. */
export interface CostBudget {
  readonly id: string;
  readonly name: string;
  readonly kind: "flow" | "ai-prompt" | "ai-agent";
  /** Declared budget (USD) for the window. */
  readonly declaredBudget: number;
  /** Actual spend in the window from Runs / AI. */
  readonly spent: number;
  /** Spend rate ÷ budget rate (1 = on pace to exhaust exactly at window end). */
  readonly burnRate: number;
  readonly remainingFraction: number;
  readonly timeToExhaustionMs: number | null;
  readonly windowMs: number;
}

/** Classic golden signals from the Runs store. */
export interface GoldenSignals {
  readonly latencyP99Ms: number;
  readonly trafficPerMin: number;
  readonly errorRate: number;
  /** Fraction of recent runs with elevated replica lag or cache miss pressure. */
  readonly saturation: number;
  readonly sampleCount: number;
  readonly windowMs: number;
}

/** Linked Manifest Diff summary — not recomputed. */
export interface WhatChanged {
  readonly hasBaseline: boolean;
  readonly severity: DiffCategory | null;
  readonly changeCount: number;
  readonly line: string;
  readonly href: string;
}

/** Day-one invitation when no SLOs are declared. */
export interface FirstSloInvite {
  readonly busiestFlow: string;
  readonly runCount: number;
  readonly href: string;
}

/** One-line plain-language health verdict. */
export interface OverviewVerdict {
  readonly line: string;
  readonly tone: "ok" | "warn" | "critical" | "empty";
}

/** Fully composed Overview projection. */
export interface OverviewView {
  readonly verdict: OverviewVerdict;
  readonly slos: readonly SloBurn[];
  readonly costBudgets: readonly CostBudget[];
  readonly whatChanged: WhatChanged;
  readonly findings: readonly OverviewFinding[];
  readonly golden: GoldenSignals;
  readonly firstSloInvite: FirstSloInvite | null;
  readonly hasDeclaredSlos: boolean;
}
