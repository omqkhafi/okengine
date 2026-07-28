/**
 * Golden signals from the Runs store (console §9.16 day-one empty state).
 *
 * Latency · traffic · errors · saturation — four numbers, one store.
 */

import type { RunRecord } from "../runs/types.ts";
import type { GoldenSignals } from "./types.ts";

/** Window for golden-signal rates (1 hour). */
export const GOLDEN_WINDOW_MS = 60 * 60 * 1000;

/** Replica lag (ms) treated as saturating. */
export const SATURATION_LAG_MS = 200;

/**
 * Compute golden signals from real Runs.
 *
 * @param runs - Wide-event population
 * @param now - Clock
 */
export function computeGoldenSignals(runs: readonly RunRecord[], now: number): GoldenSignals {
  const from = now - GOLDEN_WINDOW_MS;
  const window = runs.filter((r) => r.startedAt >= from && r.startedAt <= now);
  const n = window.length;
  const errors = window.filter((r) => !!r.error).length;
  const durations = window.map((r) => r.durationMs).sort((a, b) => a - b);
  const saturated = window.filter(
    (r) => (r.replicaLagMs != null && r.replicaLagMs > SATURATION_LAG_MS) || r.cache === "miss",
  ).length;

  return {
    latencyP99Ms: percentile(durations, 0.99),
    trafficPerMin: n === 0 ? 0 : n / (GOLDEN_WINDOW_MS / 60_000),
    errorRate: n === 0 ? 0 : errors / n,
    saturation: n === 0 ? 0 : saturated / n,
    sampleCount: n,
    windowMs: GOLDEN_WINDOW_MS,
  };
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}
