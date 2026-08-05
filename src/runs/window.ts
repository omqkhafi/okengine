/**
 * Rolling window metrics over WideEvents — shared by Console Overview and
 * Flow-facing `fx.runs` checkers (native alerting without `fx.metric`).
 */

import type { WideEvent } from "./types.ts";

/** One flow's rolling stats over a time window. */
export interface RunWindowStats {
  readonly flow: string;
  readonly total: number;
  readonly errors: number;
  readonly errorRate: number;
  readonly p50Ms: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly from: number;
  readonly to: number;
}

/**
 * Percentile of a sorted numeric array.
 *
 * @param sorted - Ascending durations
 * @param p - Percentile in (0, 1]
 */
export function percentile(sorted: readonly number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0]!;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1));
  return sorted[idx]!;
}

/**
 * Parse a Manifest latency string like `200ms` / `1s` into milliseconds.
 *
 * @param raw - Latency threshold
 */
export function parseLatencyMs(raw: string | undefined): number | null {
  if (!raw) return null;
  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m)?$/i.exec(raw.trim());
  if (!match) return null;
  const n = Number(match[1]);
  if (!Number.isFinite(n) || n < 0) return null;
  const unit = (match[2] ?? "ms").toLowerCase();
  if (unit === "s") return Math.round(n * 1000);
  if (unit === "m") return Math.round(n * 60_000);
  return Math.round(n);
}

/**
 * Compute rolling stats for one flow over `[to - windowMs, to]`.
 *
 * @param events - Wide events
 * @param flow - Flow name filter
 * @param to - Window end (epoch-ms)
 * @param windowMs - Window length
 */
export function windowStatsForFlow(
  events: readonly WideEvent[],
  flow: string,
  to: number,
  windowMs: number,
): RunWindowStats {
  const from = to - Math.max(0, windowMs);
  const mine = events.filter((e) => e.flow === flow && e.startedAt >= from && e.startedAt <= to);
  const durations = mine.map((e) => e.durationMs).sort((a, b) => a - b);
  const errors = mine.filter((e) => e.error != null).length;
  const total = mine.length;
  return {
    flow,
    total,
    errors,
    errorRate: total === 0 ? 0 : errors / total,
    p50Ms: percentile(durations, 0.5),
    p95Ms: percentile(durations, 0.95),
    p99Ms: percentile(durations, 0.99),
    from,
    to,
  };
}

/** Breach report for a declared latency / availability SLO. */
export interface SloBreach {
  readonly flow: string;
  readonly kind: "availability" | "latency_p95" | "latency_p99";
  readonly threshold: number;
  readonly observed: number;
  readonly sampleCount: number;
}

/**
 * Evaluate Manifest-style SLO thresholds against window stats.
 *
 * @param stats - Window stats
 * @param slo - Declared availability + latency
 */
export function evaluateSloBreaches(
  stats: RunWindowStats,
  slo: {
    readonly availability?: string;
    readonly latency?: { readonly p95?: string; readonly p99?: string };
  },
): SloBreach[] {
  const out: SloBreach[] = [];
  if (stats.total === 0) return out;

  if (slo.availability) {
    const match = /^(\d+(?:\.\d+)?)\s*%?$/.exec(slo.availability.trim());
    if (match) {
      const pct = Number(match[1]);
      const tolerable = Math.max(0, 1 - pct / 100);
      if (stats.errorRate > tolerable) {
        out.push({
          flow: stats.flow,
          kind: "availability",
          threshold: tolerable,
          observed: stats.errorRate,
          sampleCount: stats.total,
        });
      }
    }
  }

  const p95 = parseLatencyMs(slo.latency?.p95);
  if (p95 != null && stats.p95Ms > p95) {
    out.push({
      flow: stats.flow,
      kind: "latency_p95",
      threshold: p95,
      observed: stats.p95Ms,
      sampleCount: stats.total,
    });
  }

  const p99 = parseLatencyMs(slo.latency?.p99);
  if (p99 != null && stats.p99Ms > p99) {
    out.push({
      flow: stats.flow,
      kind: "latency_p99",
      threshold: p99,
      observed: stats.p99Ms,
      sampleCount: stats.total,
    });
  }

  return out;
}
