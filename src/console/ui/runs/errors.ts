/**
 * Error-pattern aggregation over Runs (console §9.11).
 *
 * Reuses {@link groupByDimension} on `error` — no parallel tracking store.
 */

import { groupByDimension } from "./group.ts";
import type { GroupAggregate, RunRecord } from "./types.ts";

/** Default lookback for "errors in the last hour". */
export const ERROR_WINDOW_1H_MS = 60 * 60 * 1000;

/**
 * Runs that failed inside `[now - windowMs, now]`.
 *
 * @param runs - Population
 * @param now - Epoch-ms
 * @param windowMs - Lookback window
 */
export function failedRunsInWindow(
  runs: readonly RunRecord[],
  now: number,
  windowMs: number,
): RunRecord[] {
  const from = now - Math.max(0, windowMs);
  return runs.filter(
    (r) => r.startedAt >= from && r.startedAt <= now && r.error != null && r.error !== "",
  );
}

/**
 * Aggregate "this error occurred N times in the window".
 *
 * @param runs - Population
 * @param now - Epoch-ms
 * @param windowMs - Lookback (default 1h)
 */
export function errorPatterns(
  runs: readonly RunRecord[],
  now: number,
  windowMs: number = ERROR_WINDOW_1H_MS,
): GroupAggregate[] {
  return groupByDimension(failedRunsInWindow(runs, now, windowMs), "error");
}

/**
 * Filter a population to runs started at or after `sinceMs`.
 *
 * @param runs - Population
 * @param sinceMs - Inclusive lower bound (epoch-ms); omitted = no filter
 */
export function filterRunsSince(
  runs: readonly RunRecord[],
  sinceMs: number | undefined,
): RunRecord[] {
  if (sinceMs === undefined) return [...runs];
  return runs.filter((r) => r.startedAt >= sinceMs);
}

/**
 * Parse a lookback duration (`1h`, `5m`, `30m`, `24h`) or epoch-ms string.
 *
 * @param raw - Search param value
 */
export function parseSinceWindowMs(raw: string | undefined): number | undefined {
  if (!raw || !raw.trim()) return undefined;
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) {
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)$/i.exec(trimmed);
  if (!match) return undefined;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n <= 0) return undefined;
  const unit = match[2]!.toLowerCase();
  const mult =
    unit === "ms"
      ? 1
      : unit === "s"
        ? 1_000
        : unit === "m"
          ? 60_000
          : unit === "h"
            ? 3_600_000
            : 86_400_000;
  return Math.round(n * mult);
}
