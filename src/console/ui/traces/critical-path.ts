/**
 * Critical-path highlighting for the folded waterfall (console §9.3).
 *
 * On open: *why was it slow* — the critical path is highlighted and the rest
 * dims. Path = root-to-leaf chain with maximum summed work duration.
 */

import { indexSpans } from "./chain.ts";
import type { TraceSpan } from "./types.ts";

/**
 * Span ids on the critical path of a connected component.
 *
 * @param spans - Connected spans (one trace)
 */
export function criticalPathSpanIds(
  spans: readonly TraceSpan[],
): ReadonlySet<string> {
  if (spans.length === 0) return new Set();
  const { byId, childrenOf } = indexSpans(spans);
  const roots = spans.filter(
    (s) => !s.parentId || !byId.has(s.parentId),
  );
  let best: string[] = [];
  let bestCost = -1;

  const dfs = (id: string, path: string[], cost: number): void => {
    const kids = childrenOf.get(id) ?? [];
    const span = byId.get(id);
    if (!span) return;
    const nextCost = cost + workMs(span);
    const nextPath = [...path, id];
    if (kids.length === 0) {
      if (nextCost > bestCost) {
        bestCost = nextCost;
        best = nextPath;
      }
      return;
    }
    for (const child of kids) {
      dfs(child.id, nextPath, nextCost);
    }
  };

  for (const root of roots) {
    dfs(root.id, [], 0);
  }
  return new Set(best);
}

/**
 * Active work milliseconds for a span (sum of effect durations, else wall).
 *
 * @param span - Span
 */
export function workMs(span: TraceSpan): number {
  if (span.effects.length === 0) return Math.max(0, span.durationMs);
  return span.effects.reduce((s, e) => s + Math.max(0, e.duration), 0);
}
