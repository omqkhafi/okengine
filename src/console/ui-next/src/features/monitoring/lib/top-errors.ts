/**
 * Aggregate failed runs from the Console buffer — "top errors this window".
 *
 * Keeps `latestRunId` so a row can open TraceDetailSheet. Aggregation that
 * only counts would lose the individual run reference.
 */

import type { RunRow } from "@/client.ts";
import { runFailed, runsInWindow } from "./window-stats.ts";

/** Honest empty — no failed runs in the window. */
export type TopErrorsEmpty = {
  readonly kind: "empty";
};

/** One aggregated error group. */
export type TopErrorGroup = {
  readonly key: string;
  readonly error: string;
  readonly errorMessage: string | null;
  readonly flow: string;
  readonly count: number;
  readonly latestStartedAt: number;
  readonly latestRunId: string;
};

/** Grouped failures. */
export type TopErrorsGroups = {
  readonly kind: "groups";
  readonly groups: readonly TopErrorGroup[];
  readonly windowMs: number;
};

/** Top-errors projection. */
export type TopErrors = TopErrorsEmpty | TopErrorsGroups;

/**
 * Stable group key for URL `?error=`.
 *
 * @param error - Error code
 * @param errorMessage - Optional message
 * @param flow - Flow id
 */
export function errorGroupKey(error: string, errorMessage: string | null, flow: string): string {
  return `${error}\u001f${errorMessage ?? ""}\u001f${flow}`;
}

/**
 * Group in-window failures by error + message + flow.
 *
 * Sorted by count desc, then latest start desc. Empty when nothing failed.
 *
 * @param runs - Full runs buffer
 * @param nowMs - Clock
 * @param windowMs - Lookback
 */
export function topErrors(runs: readonly RunRow[], nowMs: number, windowMs: number): TopErrors {
  const failed = runsInWindow(runs, nowMs, windowMs).filter(runFailed);
  if (failed.length === 0) return { kind: "empty" };

  const map = new Map<string, TopErrorGroup>();
  for (const run of failed) {
    const error = run.error!;
    const key = errorGroupKey(error, run.errorMessage, run.flow);
    const prev = map.get(key);
    if (!prev) {
      map.set(key, {
        key,
        error,
        errorMessage: run.errorMessage,
        flow: run.flow,
        count: 1,
        latestStartedAt: run.startedAt,
        latestRunId: run.id,
      });
      continue;
    }
    const newer = run.startedAt >= prev.latestStartedAt;
    map.set(key, {
      ...prev,
      count: prev.count + 1,
      latestStartedAt: newer ? run.startedAt : prev.latestStartedAt,
      latestRunId: newer ? run.id : prev.latestRunId,
    });
  }

  const groups = [...map.values()].sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.latestStartedAt - a.latestStartedAt;
  });
  return { kind: "groups", groups, windowMs };
}

/**
 * Filter groups by a case-insensitive substring on code / message / flow.
 *
 * @param groups - Aggregated groups
 * @param query - Search text
 */
export function filterErrorGroups(
  groups: readonly TopErrorGroup[],
  query: string,
): readonly TopErrorGroup[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) return groups;
  return groups.filter((g) => {
    return (
      g.error.toLowerCase().includes(q) ||
      g.flow.toLowerCase().includes(q) ||
      (g.errorMessage?.toLowerCase().includes(q) ?? false)
    );
  });
}

/**
 * Band groups by error code, preserving count-desc order of first appearance.
 *
 * @param groups - Filtered groups
 */
export function bandErrorGroups(
  groups: readonly TopErrorGroup[],
): ReadonlyArray<{ readonly error: string; readonly groups: readonly TopErrorGroup[] }> {
  const order: string[] = [];
  const byError = new Map<string, TopErrorGroup[]>();
  for (const group of groups) {
    const list = byError.get(group.error);
    if (!list) {
      order.push(group.error);
      byError.set(group.error, [group]);
      continue;
    }
    list.push(group);
  }
  return order.map((error) => ({ error, groups: byError.get(error) ?? [] }));
}
