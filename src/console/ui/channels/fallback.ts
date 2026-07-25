/**
 * Fallback chain + weekly cost copy (console §9.9 · §9.12).
 */

import type { FallbackMetric } from "./types.ts";

/**
 * Format the financial fallback line for the panel.
 *
 * @param metric - Fallback projection
 */
export function formatFallbackLine(metric: FallbackMetric): string {
  if (metric.totalCount === 0) {
    return "No sends in the last week";
  }
  if (metric.chainExample) {
    return `${metric.chainExample} · ${metric.summary}`;
  }
  return metric.summary;
}
