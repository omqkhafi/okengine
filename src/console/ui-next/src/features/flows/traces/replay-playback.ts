/**
 * Pure mapping helpers for the Replay playback animation.
 *
 * Playback is a single progress value in `[0, 1]` driven by Motion. These
 * helpers map that progress onto effect indices (waterfall) and ordered graph
 * node ids (chain pulse) so the animation logic stays timer-free and unit
 * testable.
 */

import type { Manifest } from "../../../../../../manifest/types.ts";
import type { WaterfallBar } from "./waterfall-bars.ts";

/**
 * Playback duration in ms for a run. Scales lightly with the run's real
 * duration but stays in a snappy band so the animation reads as a replay,
 * not a real-time re-run.
 *
 * @param runDurationMs - Run wall duration
 */
export function playbackDurationMs(runDurationMs: number): number {
  if (!Number.isFinite(runDurationMs) || runDurationMs <= 0) return 900;
  return Math.min(1600, Math.max(700, runDurationMs * 6));
}

/**
 * Index of the latest effect whose bar has started at `progress`, or `-1`
 * when the playhead has not reached the first effect yet.
 *
 * @param bars - Waterfall bars (offsetRatio in `[0, 1]`)
 * @param progress - Playback progress in `[0, 1]`
 */
export function activeEffectIndexAt(bars: readonly WaterfallBar[], progress: number): number {
  let active = -1;
  for (const bar of bars) {
    if (bar.offsetRatio <= progress) active = bar.index;
  }
  return active;
}

/**
 * Whether a bar is "played" (the playhead has passed its start).
 *
 * @param bar - Waterfall bar
 * @param progress - Playback progress in `[0, 1]`
 */
export function barPlayed(bar: WaterfallBar, progress: number): boolean {
  return bar.offsetRatio <= progress;
}

/**
 * Ordered chain steps for the graph pulse: ancestor → current → descendant
 * flow ids, with the signal node that links two consecutive flows inserted
 * between them when the Manifest declares the emit/consume pair.
 *
 * @param chainFlowIds - Flow ids on the causal chain (unordered set)
 * @param manifest - Manifest snapshot
 */
export function playbackNodeSteps(
  chainFlowIds: ReadonlySet<string>,
  manifest: Manifest | null,
): readonly string[] {
  const flows = manifest?.flows ?? {};
  const chain = [...chainFlowIds];
  const steps: string[] = [];
  for (let i = 0; i < chain.length; i++) {
    const flowId = chain[i]!;
    steps.push(`flow:${flowId}`);
    const next = chain[i + 1];
    if (!next) break;
    const signal = linkingSignal(flowId, next, flows);
    if (signal) steps.push(`signal:${signal}`);
  }
  return steps;
}

/**
 * Signal emitted by `from` that triggers `to`, when declared.
 *
 * @param from - Upstream flow id
 * @param to - Downstream flow id
 * @param flows - Manifest flows
 */
function linkingSignal(
  from: string,
  to: string,
  flows: NonNullable<Manifest["flows"]>,
): string | null {
  const upstream = flows[from];
  const downstream = flows[to];
  if (!upstream || !downstream) return null;
  const triggerSignal = downstream.trigger?.signal;
  if (!triggerSignal) return null;
  return upstream.effects?.emits?.includes(triggerSignal) ? triggerSignal : null;
}

/**
 * Active graph node id at `progress` over the ordered `steps`, or `null`
 * when there is nothing to pulse.
 *
 * @param steps - Ordered node ids from {@link playbackNodeSteps}
 * @param progress - Playback progress in `[0, 1]`
 */
export function activeNodeAt(steps: readonly string[], progress: number): string | null {
  if (steps.length === 0) return null;
  const clamped = Math.min(0.999, Math.max(0, progress));
  return steps[Math.floor(clamped * steps.length)] ?? null;
}
