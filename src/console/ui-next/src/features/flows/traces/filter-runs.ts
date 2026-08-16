/**
 * Client-side Traces filters over the already-scoped runs buffer.
 *
 * Always-on: free-text search + status.
 * Advanced: dimension query language shared with Runs (§9.11).
 */

import type { RunRow } from "@/client.ts";
import {
  EMPTY_DIMENSION_QUERY,
  filterByDimensionQuery,
  type DimensionQuery,
} from "./dimension-query.ts";

/** Status filter for the Traces pane (All / Errors only). */
export type TracesStatusFilter = "all" | "errors";

/** Active Traces list filters. */
export type TracesFilters = {
  /** Free-text needle — flow, unit, trigger, cache, error, run id. */
  readonly query: string;
  readonly status: TracesStatusFilter;
  /** Advanced dimension query (`flow = X AND …`). */
  readonly advanced: DimensionQuery;
};

/** Default filters — show every scoped run. */
export const DEFAULT_TRACES_FILTERS: TracesFilters = {
  query: "",
  status: "all",
  advanced: EMPTY_DIMENSION_QUERY,
};

/**
 * Whether a run matches the Traces search box.
 *
 * @param run - Projected run
 * @param query - Free-text needle
 */
export function runMatchesQuery(run: RunRow, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const haystacks = [
    run.flow,
    run.unit ?? "",
    run.trigger,
    run.cache,
    run.id,
    run.error ?? "",
    run.errorMessage ?? "",
  ];
  return haystacks.some((h) => h.toLowerCase().includes(q));
}

/**
 * Apply search + status + advanced dimension filters.
 *
 * @param runs - Already graph-scoped runs
 * @param filters - Active filters
 */
export function filterScopedRuns(runs: readonly RunRow[], filters: TracesFilters): RunRow[] {
  const basic = runs.filter((run) => {
    if (!runMatchesQuery(run, filters.query)) return false;
    if (filters.status === "errors" && run.error === null) return false;
    return true;
  });
  return filterByDimensionQuery(basic, filters.advanced);
}
