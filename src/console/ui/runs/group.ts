/**
 * Group-by with aggregates over a filtered run population (console §9.11).
 */

import { dimensionValue } from "./query.ts";
import type { GroupAggregate, RunRecord } from "./types.ts";

/**
 * Group runs by any dimension and compute duration/cost/count aggregates.
 *
 * @param runs - Filtered population
 * @param dimension - Dimension to group by
 */
export function groupByDimension(runs: readonly RunRecord[], dimension: string): GroupAggregate[] {
  const buckets = new Map<string, RunRecord[]>();
  for (const run of runs) {
    const raw = dimensionValue(run, dimension);
    const key = raw === undefined || raw === null || raw === "" ? "(empty)" : String(raw);
    const list = buckets.get(key) ?? [];
    list.push(run);
    buckets.set(key, list);
  }

  const rows: GroupAggregate[] = [];
  for (const [key, list] of buckets) {
    const durations = list.map((r) => r.durationMs).sort((a, b) => a - b);
    const sumDuration = durations.reduce((a, b) => a + b, 0);
    const sumCost = list.reduce((a, r) => a + (r.cost ?? 0), 0);
    rows.push({
      key,
      count: list.length,
      avgDurationMs: list.length === 0 ? 0 : sumDuration / list.length,
      p50DurationMs: percentile(durations, 0.5),
      p99DurationMs: percentile(durations, 0.99),
      sumCost,
    });
  }

  rows.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
  return rows;
}

/**
 * Discover dimension names present in a population (for group-by picker).
 *
 * @param runs - Population
 */
export function discoverDimensions(runs: readonly RunRecord[]): string[] {
  const known = new Set<string>([
    "flow",
    "unit",
    "trigger",
    "plane",
    "tenant",
    "principal",
    "cache",
    "replica",
    "error",
    "buildVersion",
    "promptVersion",
  ]);
  for (const run of runs) {
    for (const k of Object.keys(run.dimensions)) {
      if (k === "duration_ms") continue;
      known.add(k);
    }
  }
  return [...known].sort((a, b) => a.localeCompare(b));
}

function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}
