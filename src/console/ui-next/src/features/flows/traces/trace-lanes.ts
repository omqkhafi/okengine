/**
 * Collapse a long effect ledger into one lane per kind + resource.
 *
 * A loop that records hundreds of identical sends should read as one lane
 * with every occurrence on it, not as hundreds of empty waterfall tracks.
 */

import type { WaterfallBar } from "./waterfall-bars.ts";

/**
 * Effect count above which the sheet groups waterfall tracks and event rows.
 * Shorter runs keep one track and one row per effect.
 */
export const TRACE_DENSE_MIN = 24;

/** One operation lane — every bar that shares kind and resource, first-seen order. */
export type TraceLane = {
  /** Stable key (`kind` + resource). */
  readonly key: string;
  /** Effect kind (drives color and label). */
  readonly kind: WaterfallBar["kind"];
  /** Effect resource ref. */
  readonly resource: string;
  /** Bars in ledger order. */
  readonly bars: readonly WaterfallBar[];
  /** Sum of clamped bar durations. */
  readonly totalDurationMs: number;
  /** Egress identity from the first bar that left the process. */
  readonly external?: WaterfallBar["external"];
};

/**
 * True when a run is long enough to group instead of listing every effect.
 *
 * @param count - Effect count
 */
export function traceIsDense(count: number): boolean {
  return count > TRACE_DENSE_MIN;
}

/**
 * Group waterfall bars by kind and resource, preserving first-seen order.
 *
 * @param bars - Positioned bars (ledger order)
 */
export function traceLanes(bars: readonly WaterfallBar[]): readonly TraceLane[] {
  const order: string[] = [];
  const groups = new Map<string, WaterfallBar[]>();
  for (const bar of bars) {
    const key = `${bar.kind}\0${bar.resource}`;
    const list = groups.get(key);
    if (list) {
      list.push(bar);
      continue;
    }
    groups.set(key, [bar]);
    order.push(key);
  }

  return order.map((key) => {
    const laneBars = groups.get(key)!;
    const first = laneBars[0]!;
    let totalDurationMs = 0;
    let external = first.external;
    for (const bar of laneBars) {
      totalDurationMs += bar.durationMs;
      if (!external && bar.external) external = bar.external;
    }
    return {
      key,
      kind: first.kind,
      resource: first.resource,
      bars: laneBars,
      totalDurationMs,
      ...(external !== undefined ? { external } : {}),
    };
  });
}
