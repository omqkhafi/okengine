/**
 * Proportional waterfall bar layout from real {@link EffectEntry} timing.
 *
 * Each bar's offset/width is `(timestamp - startedAt) / durationMs` and
 * `duration / durationMs` — never evenly spaced placeholders.
 */

import type { RunEffect } from "@/client.ts";

/** One positioned bar in the effect waterfall. */
export type WaterfallBar = {
  /** Index into the source `effects` array (stable identity for hover sync). */
  readonly index: number;
  /** Effect kind (drives color). */
  readonly kind: RunEffect["kind"];
  /** Effect resource ref. */
  readonly resource: string;
  /** Start offset from run `startedAt`, in ms (clamped to the run window). */
  readonly startOffsetMs: number;
  /** Effect duration in ms (clamped so the bar stays inside the run window). */
  readonly durationMs: number;
  /**
   * Left edge as a fraction of the run window `[0, 1]`.
   * `0` when the effect starts at `startedAt`.
   */
  readonly offsetRatio: number;
  /**
   * Width as a fraction of the run window `[0, 1]`.
   * An effect ending exactly at `startedAt + durationMs` yields
   * `offsetRatio + widthRatio === 1`.
   */
  readonly widthRatio: number;
};

/**
 * Layout waterfall bars from real effect timestamps against a run window.
 *
 * Overlapping effects keep independent positions (both render). Effects that
 * start before `startedAt` or extend past `startedAt + durationMs` are clamped
 * to the window. When `durationMs <= 0`, every bar collapses to zero width at
 * offset 0.
 *
 * @param effects - Ledger entries with real `timestamp` / `duration`
 * @param startedAt - Run epoch-ms start
 * @param durationMs - Run wall duration
 */
export function waterfallBars(
  effects: readonly RunEffect[],
  startedAt: number,
  durationMs: number,
): readonly WaterfallBar[] {
  if (!Number.isFinite(startedAt) || !Number.isFinite(durationMs) || durationMs <= 0) {
    return effects.map((effect, index) => ({
      index,
      kind: effect.kind,
      resource: effect.resource,
      startOffsetMs: 0,
      durationMs: 0,
      offsetRatio: 0,
      widthRatio: 0,
    }));
  }

  return effects.map((effect, index) => {
    const rawStart = Number.isFinite(effect.timestamp) ? effect.timestamp - startedAt : 0;
    const rawDuration = Number.isFinite(effect.duration) ? Math.max(0, effect.duration) : 0;
    const startOffsetMs = Math.min(durationMs, Math.max(0, rawStart));
    const endOffsetMs = Math.min(durationMs, Math.max(startOffsetMs, rawStart + rawDuration));
    const clampedDuration = endOffsetMs - startOffsetMs;
    return {
      index,
      kind: effect.kind,
      resource: effect.resource,
      startOffsetMs,
      durationMs: clampedDuration,
      offsetRatio: startOffsetMs / durationMs,
      widthRatio: clampedDuration / durationMs,
    };
  });
}
