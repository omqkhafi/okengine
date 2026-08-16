/**
 * Rolling window stats over the Console runs buffer — client port of
 * `windowStatsForFlow` that does not call `fx.runs.window`.
 *
 * Empty buffer / no in-window rows → honest empty (never "0 calls").
 */

import type { RunRow } from "@/client.ts";

/** URL window tokens for Monitoring. */
export const MONITORING_WINDOWS = {
  "15m": 15 * 60_000,
  "1h": 60 * 60_000,
  "24h": 24 * 60 * 60_000,
  "7d": 7 * 24 * 60 * 60_000,
} as const;

/** One Monitoring lookback token. */
export type MonitoringWindow = keyof typeof MONITORING_WINDOWS;

/** Default lookback — current-moment strip. */
export const DEFAULT_MONITORING_WINDOW: MonitoringWindow = "1h";

/** Honest empty — no buffered runs in the window. */
export type WindowStatsEmpty = {
  readonly kind: "empty";
};

/** Real counts derived from buffered runs. */
export type WindowStatsSummary = {
  readonly kind: "summary";
  readonly total: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly from: number;
  readonly to: number;
  readonly windowMs: number;
};

/** Window projection. */
export type WindowStats = WindowStatsEmpty | WindowStatsSummary;

/**
 * Parse a URL window token. Unknown values fall back to the default.
 *
 * @param raw - Search param
 */
export function parseMonitoringWindow(raw: unknown): MonitoringWindow {
  if (raw === "15m" || raw === "1h" || raw === "24h" || raw === "7d") return raw;
  return DEFAULT_MONITORING_WINDOW;
}

/**
 * Whether a projected run failed.
 *
 * @param run - Run row
 */
export function runFailed(run: Pick<RunRow, "error">): boolean {
  return run.error != null && run.error.length > 0;
}

/**
 * Percentile of a sorted numeric array (nearest-rank, matches `src/runs/window.ts`).
 *
 * @param sorted - Ascending values
 * @param p - Percentile in (0, 1]
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Runs that started inside `[nowMs - windowMs, nowMs]`.
 *
 * @param runs - Full runs buffer
 * @param nowMs - Clock
 * @param windowMs - Lookback
 */
export function runsInWindow(
  runs: readonly RunRow[],
  nowMs: number,
  windowMs: number,
): readonly RunRow[] {
  const from = nowMs - Math.max(0, windowMs);
  return runs.filter((r) => r.startedAt >= from && r.startedAt <= nowMs);
}

/**
 * Compute rolling stats over all flows in the window.
 *
 * @param runs - Full runs buffer
 * @param nowMs - Clock
 * @param windowMs - Lookback
 */
export function windowStatsForRuns(
  runs: readonly RunRow[],
  nowMs: number,
  windowMs: number,
): WindowStats {
  const inWindow = runsInWindow(runs, nowMs, windowMs);
  if (inWindow.length === 0) return { kind: "empty" };

  const durations = inWindow.map((r) => r.durationMs).sort((a, b) => a - b);
  const errors = inWindow.filter(runFailed).length;
  const total = inWindow.length;
  return {
    kind: "summary",
    total,
    errors,
    errorRate: errors / total,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    from: nowMs - Math.max(0, windowMs),
    to: nowMs,
    windowMs,
  };
}
