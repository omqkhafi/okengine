/**
 * Timeline ruler ticks, idle-gap detection, and zoom viewport mapping for the
 * trace waterfall — all derived from real run duration + effect windows.
 */

import type { WaterfallBar } from "./waterfall-bars.ts";

/** One tick on the waterfall time ruler. */
export type TimelineTick = {
  /** Offset from run start in ms. */
  readonly offsetMs: number;
  /** Position as a fraction of the visible view `[0, 1]`. */
  readonly viewRatio: number;
  /** Whether this is the final (duration) tick. */
  readonly isEnd: boolean;
};

/** Idle span — wall time with no recorded effect coverage. */
export type WaterfallGap = {
  /** Start offset from run start in ms. */
  readonly startOffsetMs: number;
  /** Gap length in ms. */
  readonly durationMs: number;
  /** Left edge as a fraction of the full run window `[0, 1]`. */
  readonly offsetRatio: number;
  /** Width as a fraction of the full run window `[0, 1]`. */
  readonly widthRatio: number;
};

/** Visible slice of the run timeline (zoom window). */
export type TimelineView = {
  /** Left edge of the viewport as a fraction of the run `[0, 1)`. */
  readonly startRatio: number;
  /** Viewport width as a fraction of the run `(0, 1]`. */
  readonly widthRatio: number;
  /** Zoom multiplier (`1` = full run). */
  readonly zoom: number;
};

/** Allowed zoom steps for the waterfall controls. */
export const WATERFALL_ZOOM_STEPS = [1, 2, 4, 8] as const;

/**
 * Build a zoom viewport clamped inside the run.
 *
 * @param zoom - Zoom multiplier (≥ 1)
 * @param startRatio - Desired left edge (run fraction)
 */
export function timelineView(zoom: number, startRatio: number = 0): TimelineView {
  const z = Number.isFinite(zoom) && zoom >= 1 ? zoom : 1;
  const widthRatio = 1 / z;
  const start = Number.isFinite(startRatio) ? Math.max(0, startRatio) : 0;
  const clampedStart = Math.min(start, Math.max(0, 1 - widthRatio));
  return { startRatio: clampedStart, widthRatio, zoom: z };
}

/**
 * Map a run-window ratio into the current zoom viewport (`null` if fully outside).
 *
 * @param offsetRatio - Bar/gap left edge in run space
 * @param widthRatio - Bar/gap width in run space
 * @param view - Active viewport
 */
export function mapToViewport(
  offsetRatio: number,
  widthRatio: number,
  view: TimelineView,
): { readonly left: number; readonly width: number } | null {
  const start = offsetRatio;
  const end = offsetRatio + widthRatio;
  const viewEnd = view.startRatio + view.widthRatio;
  if (end <= view.startRatio || start >= viewEnd) return null;
  const clippedStart = Math.max(start, view.startRatio);
  const clippedEnd = Math.min(end, viewEnd);
  return {
    left: (clippedStart - view.startRatio) / view.widthRatio,
    width: (clippedEnd - clippedStart) / view.widthRatio,
  };
}

/**
 * Nice tick offsets across a duration (always includes 0 and durationMs).
 *
 * @param durationMs - Run wall duration
 * @param maxTicks - Soft cap on interior ticks (default 5 → ≤7 total with ends)
 */
export function timelineTickOffsets(durationMs: number, maxTicks: number = 5): readonly number[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [0];
  const step = niceStep(durationMs, maxTicks);
  const out: number[] = [0];
  for (let t = step; t < durationMs - step * 0.25; t += step) {
    out.push(Math.round(t * 1000) / 1000);
  }
  if (out[out.length - 1] !== durationMs) out.push(durationMs);
  return out;
}

/**
 * Ticks projected into the current zoom viewport.
 *
 * @param durationMs - Full run duration
 * @param view - Active viewport
 * @param maxTicks - Soft cap for ticks inside the view
 */
export function timelineTicksForView(
  durationMs: number,
  view: TimelineView,
  maxTicks: number = 5,
): readonly TimelineTick[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) {
    return [{ offsetMs: 0, viewRatio: 0, isEnd: true }];
  }
  const viewStartMs = view.startRatio * durationMs;
  const viewDurationMs = view.widthRatio * durationMs;
  const offsets = timelineTickOffsets(viewDurationMs, maxTicks).map((o) => viewStartMs + o);
  // Always pin the visible right edge label to the view end (or run end).
  const viewEndMs = Math.min(durationMs, viewStartMs + viewDurationMs);
  if (offsets[offsets.length - 1] !== viewEndMs) {
    offsets[offsets.length - 1] = viewEndMs;
  }
  return offsets.map((offsetMs, i) => ({
    offsetMs,
    viewRatio: (offsetMs - viewStartMs) / viewDurationMs,
    isEnd: i === offsets.length - 1,
  }));
}

/**
 * Idle gaps — intervals inside the run with no effect coverage.
 *
 * Overlapping / nested effects merge into one busy span. A gap before the first
 * effect, between effects, or after the last effect is included when duration > 0.
 *
 * @param bars - Positioned effect bars
 * @param durationMs - Run wall duration
 */
export function waterfallGaps(
  bars: readonly WaterfallBar[],
  durationMs: number,
): readonly WaterfallGap[] {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return [];

  const busy = mergeBusyIntervals(bars, durationMs);
  const gaps: WaterfallGap[] = [];
  let cursor = 0;
  for (const [start, end] of busy) {
    if (start > cursor) {
      gaps.push(gapAt(cursor, start, durationMs));
    }
    cursor = Math.max(cursor, end);
  }
  if (cursor < durationMs) {
    gaps.push(gapAt(cursor, durationMs, durationMs));
  }
  return gaps.filter((g) => g.durationMs > 0 && g.widthRatio > 0);
}

function gapAt(start: number, end: number, durationMs: number): WaterfallGap {
  const startOffsetMs = Math.max(0, start);
  const duration = Math.max(0, end - startOffsetMs);
  return {
    startOffsetMs,
    durationMs: duration,
    offsetRatio: startOffsetMs / durationMs,
    widthRatio: duration / durationMs,
  };
}

function mergeBusyIntervals(
  bars: readonly WaterfallBar[],
  durationMs: number,
): Array<[number, number]> {
  const ranges = bars
    .map((b) => {
      const start = Math.max(0, Math.min(durationMs, b.startOffsetMs));
      const end = Math.max(start, Math.min(durationMs, b.startOffsetMs + b.durationMs));
      return [start, end] as [number, number];
    })
    .filter(([s, e]) => e > s)
    .sort((a, b) => a[0]! - b[0]!);

  const merged: Array<[number, number]> = [];
  for (const range of ranges) {
    const last = merged[merged.length - 1];
    if (!last || range[0] > last[1]) {
      merged.push([range[0], range[1]]);
    } else {
      last[1] = Math.max(last[1], range[1]);
    }
  }
  return merged;
}

function niceStep(durationMs: number, maxTicks: number): number {
  const rough = durationMs / Math.max(1, maxTicks);
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-6)));
  const normalized = rough / pow;
  let nice: number;
  if (normalized <= 1) nice = 1;
  else if (normalized <= 2) nice = 2;
  else if (normalized <= 5) nice = 5;
  else nice = 10;
  return nice * pow;
}

/**
 * Next zoom step (or same if already max).
 *
 * @param zoom - Current zoom
 */
export function zoomInStep(zoom: number): number {
  return (
    WATERFALL_ZOOM_STEPS.find((z) => z > zoom) ??
    WATERFALL_ZOOM_STEPS[WATERFALL_ZOOM_STEPS.length - 1]!
  );
}

/**
 * Previous zoom step (or 1 if already min).
 *
 * @param zoom - Current zoom
 */
export function zoomOutStep(zoom: number): number {
  let prev: number = WATERFALL_ZOOM_STEPS[0]!;
  for (const z of WATERFALL_ZOOM_STEPS) {
    if (z >= zoom) return prev;
    prev = z;
  }
  return prev;
}
