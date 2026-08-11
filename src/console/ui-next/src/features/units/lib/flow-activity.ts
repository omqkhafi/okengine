/**
 * Recent activity summary for one flow — scoped from the real runs buffer.
 *
 * Empty buffer / no in-window rows → honest empty (never "0 calls" as fake data).
 */

import type { RunRow } from "@/client.ts";
import { scopeRunsToFlows } from "@/features/flows/traces/scope-runs.ts";

/** Default lookback window for the Units activity strip (1 hour). */
export const FLOW_ACTIVITY_WINDOW_MS = 60 * 60 * 1000;

/** Honest empty — no buffered runs for this flow in the window. */
export type FlowActivityEmpty = {
  readonly kind: "empty";
};

/** Real counts derived from buffered runs. */
export type FlowActivityStats = {
  readonly kind: "summary";
  readonly calls: number;
  readonly errors: number;
  /** `errors / calls` in `[0, 1]`. */
  readonly errorRate: number;
  readonly lastStartedAt: number;
  readonly latestRunId: string;
  readonly windowMs: number;
};

/** Activity strip projection. */
export type FlowActivitySummary = FlowActivityEmpty | FlowActivityStats;

/**
 * Summarize recent runs for one flow from the Console runs buffer.
 *
 * Uses {@link scopeRunsToFlows} then a time window. When nothing matches,
 * returns `{ kind: "empty" }` — callers must not invent zeros.
 *
 * @param runs - Full runs buffer (may include other flows)
 * @param flowId - Selected flow id
 * @param nowMs - Clock (injectable for tests)
 * @param windowMs - Lookback window
 */
export function flowActivitySummary(
  runs: readonly RunRow[],
  flowId: string,
  nowMs: number,
  windowMs: number = FLOW_ACTIVITY_WINDOW_MS,
): FlowActivitySummary {
  const scoped = scopeRunsToFlows(runs, new Set([flowId]));
  const cutoff = nowMs - windowMs;
  const inWindow = scoped.filter((r) => r.startedAt >= cutoff);
  if (inWindow.length === 0) {
    return { kind: "empty" };
  }

  const errors = inWindow.filter((r) => r.error != null && r.error.length > 0).length;
  const latest = inWindow[0]!;
  return {
    kind: "summary",
    calls: inWindow.length,
    errors,
    errorRate: errors / inWindow.length,
    lastStartedAt: latest.startedAt,
    latestRunId: latest.id,
    windowMs,
  };
}
