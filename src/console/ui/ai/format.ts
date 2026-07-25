/**
 * Display helpers for AI panel distributions and trails (console §9.10).
 */

import type { AgentToolEffect, AiDistributionBucket } from "./types.ts";

/**
 * Format a rate as a percentage string.
 *
 * @param rate - 0..1
 */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
}

/**
 * Format USD cost.
 *
 * @param cost - Dollars
 */
export function formatCost(cost: number): string {
  return `$${cost.toFixed(4)}`;
}

/**
 * Format latency.
 *
 * @param ms - Milliseconds
 */
export function formatLatency(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)}s`;
  return `${Math.round(ms)}ms`;
}

/**
 * Format eval score.
 *
 * @param score - 0..1
 */
export function formatEval(score: number): string {
  return `${(score * 100).toFixed(1)}%`;
}

/**
 * Accessible summary of a distribution (no axes — text first).
 *
 * @param label - Metric name
 * @param mean - Mean
 * @param p50 - Median
 * @param p95 - p95
 * @param format - Value formatter
 */
export function distributionSummary(
  label: string,
  mean: number,
  p50: number,
  p95: number,
  format: (n: number) => string,
): string {
  return `${label}: mean ${format(mean)}, p50 ${format(p50)}, p95 ${format(p95)}`;
}

/**
 * Max count in buckets (for bar width).
 *
 * @param buckets - Histogram
 */
export function maxBucketCount(
  buckets: readonly AiDistributionBucket[],
): number {
  return buckets.reduce((m, b) => Math.max(m, b.count), 0);
}

/**
 * Format an effect for the trail (tier vocabulary).
 *
 * @param effect - Tool effect
 */
export function formatEffect(effect: AgentToolEffect): string {
  return `${effect.kind} ${effect.resource}`;
}

/**
 * Label for a trail line — denial is never "error".
 *
 * @param status - ok | denied
 */
export function trailStatusLabel(status: "ok" | "denied"): string {
  return status === "denied" ? "DENIED" : "ok";
}
