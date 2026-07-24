/**
 * Automatic outlier explanation — compare every dimension between a selected
 * population and the rest (console §9.11).
 *
 * "94% cache=miss vs 6%" — the system surfaces separating dimensions nobody
 * asked about, because all dimensions are declared and typed.
 */

import type { RunDimensions, WideEvent } from "./types.ts";

/** One dimension that separates outliers from the baseline. */
export interface OutlierFinding {
  /** Dimension name. */
  readonly dimension: string;
  /** Value enriched in the outlier population. */
  readonly value: string;
  /** Share of outliers carrying this value (0–1). */
  readonly outlierShare: number;
  /** Share of baseline carrying this value (0–1). */
  readonly baselineShare: number;
  /** Absolute lift (`outlierShare - baselineShare`). */
  readonly lift: number;
  /** Human-readable line matching the Console voice. */
  readonly explanation: string;
}

/** Options for {@link explainOutliers}. */
export interface ExplainOutliersOptions {
  /**
   * Predicate selecting the outlier population (e.g. slow runs).
   *
   * @param event - Wide event
   */
  readonly select: (event: WideEvent) => boolean;
  /** Max findings to return (default 10). */
  readonly limit?: number;
  /** Minimum absolute lift to report (default 0.15). */
  readonly minLift?: number;
  /** Dimensions to ignore. */
  readonly ignore?: readonly string[];
}

/**
 * Explain what separates a selected population from the rest.
 *
 * @param events - Seeded or queried wide events
 * @param options - Selection + thresholds
 */
export function explainOutliers(
  events: readonly WideEvent[],
  options: ExplainOutliersOptions,
): OutlierFinding[] {
  const outliers = events.filter(options.select);
  const baseline = events.filter((e) => !options.select(e));
  if (outliers.length === 0 || baseline.length === 0) return [];

  const ignore = new Set(options.ignore ?? ["duration_ms", "flow"]);
  const minLift = options.minLift ?? 0.15;
  const limit = options.limit ?? 10;

  const dimNames = new Set<string>();
  for (const e of events) {
    for (const k of Object.keys(e.dimensions)) {
      if (!ignore.has(k)) dimNames.add(k);
    }
  }

  const findings: OutlierFinding[] = [];
  for (const dim of dimNames) {
    const outlierCounts = valueCounts(outliers, dim);
    const baselineCounts = valueCounts(baseline, dim);
    const values = new Set([
      ...outlierCounts.keys(),
      ...baselineCounts.keys(),
    ]);
    for (const value of values) {
      const outlierShare = (outlierCounts.get(value) ?? 0) / outliers.length;
      const baselineShare =
        (baselineCounts.get(value) ?? 0) / baseline.length;
      const lift = outlierShare - baselineShare;
      if (lift < minLift) continue;
      findings.push({
        dimension: dim,
        value,
        outlierShare,
        baselineShare,
        lift,
        explanation: formatExplanation(dim, value, outlierShare, baselineShare),
      });
    }
  }

  findings.sort((a, b) => b.lift - a.lift);
  return findings.slice(0, limit);
}

/**
 * Seed a dataset where one dimension cleanly separates slow runs.
 *
 * @param opts - Size + separating dimension
 */
export function seedOutlierDataset(opts?: {
  readonly n?: number;
  readonly slowShare?: number;
  readonly separatingDimension?: string;
  readonly separatingValue?: string;
  readonly slowDurationMs?: number;
  readonly fastDurationMs?: number;
}): WideEvent[] {
  const n = opts?.n ?? 1000;
  const slowShare = opts?.slowShare ?? 0.1;
  const dim = opts?.separatingDimension ?? "cache";
  const sepValue = opts?.separatingValue ?? "miss";
  const slowMs = opts?.slowDurationMs ?? 2000;
  const fastMs = opts?.fastDurationMs ?? 50;
  const slowCount = Math.floor(n * slowShare);

  const events: WideEvent[] = [];
  for (let i = 0; i < n; i++) {
    const slow = i < slowCount;
    // 90% of slow runs carry the separating value; 5% of fast runs do.
    const carriesSep = slow ? i % 10 !== 0 : i % 20 === 0;
    const dimValue = carriesSep ? sepValue : dim === "cache" ? "hit" : "other";
    const durationMs = slow ? slowMs : fastMs;
    const startedAt = 1_700_000_000_000 + i;
    const dimensions: RunDimensions = {
      flow: "book",
      trigger: "http",
      plane: "user",
      tenant: i % 7 === 0 ? "org_a41" : `org_${i % 50}`,
      cache: dim === "cache" ? dimValue : i % 3 === 0 ? "miss" : "hit",
      [dim]: dimValue,
      duration_ms: durationMs,
    };
    events.push({
      id: `run_${i}`,
      flow: "book",
      trigger: "http",
      plane: "user",
      tenant: String(dimensions.tenant),
      principal: `user_${i % 100}`,
      subjectId: `user_${i % 100}`,
      gates: ["member"],
      cache: (dimensions.cache as "hit" | "miss") ?? "none",
      effects: [],
      logs: [],
      durationMs,
      startedAt,
      endedAt: startedAt + durationMs,
      dimensions,
      error: null,
    });
  }
  return events;
}

function valueCounts(
  events: readonly WideEvent[],
  dim: string,
): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    const raw = e.dimensions[dim];
    if (raw === undefined || raw === null) continue;
    const key = String(raw);
    m.set(key, (m.get(key) ?? 0) + 1);
  }
  return m;
}

function formatExplanation(
  dim: string,
  value: string,
  outlierShare: number,
  baselineShare: number,
): string {
  const o = Math.round(outlierShare * 100);
  const b = Math.round(baselineShare * 100);
  return `${o}% ${dim}=${value} vs ${b}%`;
}
