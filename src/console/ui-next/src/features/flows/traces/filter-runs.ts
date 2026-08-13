/**
 * Client-side Traces filters over the already-scoped runs buffer.
 *
 * Always-on: status + duration threshold.
 * Advanced: dimension query language shared with Runs (§9.11).
 */

import type { RunRow } from "@/client.ts";
import { DURATION_THRESHOLD_OPTIONS, type DurationThresholdMs } from "./duration-tone.ts";
import {
  EMPTY_DIMENSION_QUERY,
  filterByDimensionQuery,
  type DimensionQuery,
} from "./dimension-query.ts";

/** Status filter for the Traces pane (All / Errors only). */
export type TracesStatusFilter = "all" | "errors";

/** Duration threshold presets — shared with duration tone bands. */
export type TracesDurationThresholdMs = DurationThresholdMs;

/** Active Traces list filters. */
export type TracesFilters = {
  readonly status: TracesStatusFilter;
  readonly minDurationMs: TracesDurationThresholdMs;
  /** Advanced dimension query (`flow = X AND …`). */
  readonly advanced: DimensionQuery;
};

/** Default filters — show every scoped run. */
export const DEFAULT_TRACES_FILTERS: TracesFilters = {
  status: "all",
  minDurationMs: null,
  advanced: EMPTY_DIMENSION_QUERY,
};

/** Re-export threshold options for the Traces filter select. */
export { DURATION_THRESHOLD_OPTIONS };

/**
 * Apply status + duration-threshold + advanced dimension filters.
 *
 * @param runs - Already graph-scoped runs
 * @param filters - Active filters
 */
export function filterScopedRuns(runs: readonly RunRow[], filters: TracesFilters): RunRow[] {
  const basic = runs.filter((run) => {
    if (filters.status === "errors" && run.error === null) return false;
    if (filters.minDurationMs !== null && run.durationMs <= filters.minDurationMs) {
      return false;
    }
    return true;
  });
  return filterByDimensionQuery(basic, filters.advanced);
}

/**
 * Human label for a duration threshold preset.
 *
 * @param ms - Threshold or null
 */
export function durationThresholdLabel(ms: TracesDurationThresholdMs): string {
  if (ms === null) return "Any duration";
  if (ms >= 1_000 && ms % 1_000 === 0) return `> ${ms / 1_000}s`;
  return `> ${ms}ms`;
}
