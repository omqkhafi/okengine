/**
 * Inline mini-waterfall for list rows (console §9.3).
 */

import { peakSpanTier, tierOfKind } from "./tier.ts";
import type { MiniBar, TraceSpan } from "./types.ts";

/**
 * Build proportional mini-bars for a root row (connected spans).
 *
 * @param spans - Spans in the root's connected component
 */
export function miniWaterfall(spans: readonly TraceSpan[]): MiniBar[] {
  if (spans.length === 0) return [];
  const start = Math.min(...spans.map((s) => s.startedAt));
  const end = Math.max(...spans.map((s) => s.endedAt));
  const wall = Math.max(1, end - start);

  if (spans.every((s) => s.effects.length === 0)) {
    return spans.map((s) => ({
      start: (s.startedAt - start) / wall,
      width: Math.max(0.02, s.durationMs / wall),
      tier: peakSpanTier(s.effects),
      failed: s.errorCode != null,
    }));
  }

  const bars: MiniBar[] = [];
  for (const s of spans) {
    if (s.effects.length === 0) {
      bars.push({
        start: (s.startedAt - start) / wall,
        width: Math.max(0.02, s.durationMs / wall),
        tier: "none",
        failed: s.errorCode != null,
      });
      continue;
    }
    for (let i = 0; i < s.effects.length; i++) {
      const e = s.effects[i];
      if (!e) continue;
      bars.push({
        start: (e.timestamp - start) / wall,
        width: Math.max(0.02, e.duration / wall),
        tier: tierOfKind(e.kind),
        failed: s.errorCode != null && i === s.effects.length - 1,
      });
    }
  }
  return bars;
}

/**
 * Typed error code for a root row — first failure in the chain, else null.
 *
 * @param spans - Connected spans
 */
export function rootErrorCode(spans: readonly TraceSpan[]): string | null {
  for (const s of spans) {
    if (s.errorCode) return s.errorCode;
  }
  return null;
}
