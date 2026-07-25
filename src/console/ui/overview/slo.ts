/**
 * SLO burn rates from declared Manifest objectives + real Runs (console §9.16).
 *
 * Burn rate = current error rate ÷ tolerable rate. Thresholds come only from
 * Manifest `slo.availability` — never invented here.
 */

import type { Journey, Manifest, Slo } from "../../../manifest/types.ts";
import type { RunRecord } from "../runs/types.ts";
import type { SloBurn } from "./types.ts";

/** Short window for "current" burn (1 hour). */
export const BURN_SHORT_WINDOW_MS = 60 * 60 * 1000;

/** Long window for remaining budget (30 days). */
export const BURN_LONG_WINDOW_MS = 30 * 86_400_000;

/** Ceremonial: no burn ≥ 1× in this lookback. */
export const CEREMONIAL_LOOKBACK_MS = 90 * 86_400_000;

/** Bucket size when scanning burn history. */
export const BURN_HISTORY_BUCKET_MS = 60 * 60 * 1000;

/** One declared objective extracted from the Manifest. */
export interface DeclaredSlo {
  readonly id: string;
  readonly kind: "flow" | "journey";
  readonly name: string;
  readonly availability: string;
  readonly tolerableErrorRate: number;
  readonly flowIds: readonly string[];
}

/**
 * Parse an availability string like `99.9%` into a tolerable error rate.
 *
 * @param availability - Manifest SLO availability
 */
export function parseAvailability(availability: string): number | null {
  const trimmed = availability.trim();
  const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(trimmed);
  if (!match) return null;
  const pct = Number(match[1]);
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return null;
  return Math.max(0, 1 - pct / 100);
}

/**
 * Collect flow- and journey-level SLOs declared on the Manifest.
 *
 * @param manifest - Current Manifest
 */
export function declaredSlos(manifest: Manifest | null): readonly DeclaredSlo[] {
  if (!manifest) return [];
  const out: DeclaredSlo[] = [];

  for (const [name, flow] of Object.entries(manifest.flows ?? {})) {
    const slo = flow.slo;
    const availability = slo?.availability;
    if (!availability) continue;
    const tolerable = parseAvailability(availability);
    if (tolerable == null) continue;
    out.push({
      id: `flow:${name}`,
      kind: "flow",
      name,
      availability,
      tolerableErrorRate: tolerable,
      flowIds: [name],
    });
  }

  for (const [name, journey] of Object.entries(manifest.journeys ?? {})) {
    const availability = journey.slo?.availability;
    if (!availability) continue;
    const tolerable = parseAvailability(availability);
    if (tolerable == null) continue;
    out.push({
      id: `journey:${name}`,
      kind: "journey",
      name,
      availability,
      tolerableErrorRate: tolerable,
      flowIds: journeyFlowIds(journey),
    });
  }

  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Compute burn for every declared SLO against real Runs.
 *
 * @param options - Manifest, runs, clock
 */
export function computeSloBurns(options: {
  readonly manifest: Manifest | null;
  readonly runs: readonly RunRecord[];
  readonly now: number;
}): readonly SloBurn[] {
  const objectives = declaredSlos(options.manifest);
  return objectives.map((obj) =>
    burnForObjective(obj, options.runs, options.now),
  );
}

/**
 * Whether any declared SLO exists on the Manifest.
 *
 * @param manifest - Current Manifest
 */
export function hasDeclaredSlos(manifest: Manifest | null): boolean {
  return declaredSlos(manifest).length > 0;
}

function burnForObjective(
  obj: DeclaredSlo,
  runs: readonly RunRecord[],
  now: number,
): SloBurn {
  const short = windowStats(runs, obj.flowIds, now - BURN_SHORT_WINDOW_MS, now);
  const long = windowStats(runs, obj.flowIds, now - BURN_LONG_WINDOW_MS, now);
  const currentErrorRate = short.errorRate;
  const burnRate =
    obj.tolerableErrorRate <= 0
      ? currentErrorRate > 0
        ? Number.POSITIVE_INFINITY
        : 0
      : currentErrorRate / obj.tolerableErrorRate;

  const budget = long.total * obj.tolerableErrorRate;
  const remaining = Math.max(0, budget - long.errors);
  const remainingBudgetFraction =
    budget <= 0 ? (long.errors > 0 ? 0 : 1) : remaining / budget;

  const excessRate = currentErrorRate - obj.tolerableErrorRate;
  let timeToExhaustionMs: number | null = null;
  if (excessRate > 0 && short.total > 0) {
    const requestRatePerMs = short.total / BURN_SHORT_WINDOW_MS;
    const excessErrorsPerMs = excessRate * requestRatePerMs;
    if (excessErrorsPerMs > 0) {
      timeToExhaustionMs = remaining / excessErrorsPerMs;
    }
  }

  const lastBurnAt = lastBurnTimestamp(
    runs,
    obj.flowIds,
    obj.tolerableErrorRate,
    now,
  );
  const ceremonial =
    lastBurnAt == null || now - lastBurnAt >= CEREMONIAL_LOOKBACK_MS;

  return {
    id: obj.id,
    kind: obj.kind,
    name: obj.name,
    availability: obj.availability,
    tolerableErrorRate: obj.tolerableErrorRate,
    currentErrorRate,
    burnRate,
    remainingBudgetFraction,
    timeToExhaustionMs,
    ceremonial,
    lastBurnAt,
    sampleCount: short.total,
    errorCount: short.errors,
  };
}

function windowStats(
  runs: readonly RunRecord[],
  flowIds: readonly string[],
  from: number,
  to: number,
): { readonly total: number; readonly errors: number; readonly errorRate: number } {
  const set = new Set(flowIds);
  let total = 0;
  let errors = 0;
  for (const r of runs) {
    if (r.startedAt < from || r.startedAt > to) continue;
    if (set.size > 0 && !set.has(r.flow)) continue;
    total += 1;
    if (r.error) errors += 1;
  }
  return {
    total,
    errors,
    errorRate: total === 0 ? 0 : errors / total,
  };
}

/**
 * Scan hourly buckets over 90 days for the last time burn rate ≥ 1.
 */
function lastBurnTimestamp(
  runs: readonly RunRecord[],
  flowIds: readonly string[],
  tolerable: number,
  now: number,
): number | null {
  if (tolerable <= 0) return null;
  const start = now - CEREMONIAL_LOOKBACK_MS;
  let last: number | null = null;
  for (
    let bucketStart = start;
    bucketStart < now;
    bucketStart += BURN_HISTORY_BUCKET_MS
  ) {
    const bucketEnd = Math.min(now, bucketStart + BURN_HISTORY_BUCKET_MS);
    const stats = windowStats(runs, flowIds, bucketStart, bucketEnd);
    if (stats.total === 0) continue;
    if (stats.errorRate / tolerable >= 1) {
      last = bucketEnd;
    }
  }
  return last;
}

function journeyFlowIds(journey: Journey): readonly string[] {
  const flows = journey.flows ?? [];
  return flows.map((f) => (typeof f === "string" ? f : String(f)));
}

/** @internal — exported for tests that assert latency SLO presence is ignored for burn. */
export function sloHasAvailability(slo: Slo | undefined): boolean {
  return typeof slo?.availability === "string" && slo.availability.length > 0;
}
