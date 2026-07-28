/**
 * Folded-time waterfall (console §9.3).
 *
 * Dead time collapses into a labelled, expandable bar the way a diff folds
 * unchanged lines; real work stays exactly proportional. One linear scale
 * serves a 20 ms trace and a week-long one — no modes, no log axis.
 */

import { tierOfKind } from "./tier.ts";
import type { TimelineSegment, TraceSpan, WorkInterval } from "./types.ts";

/** Collapsed fold occupies this much of the display scale (ms-equivalent). */
export const COLLAPSED_FOLD_DISPLAY_MS = 40;

/** Gaps at or above this threshold become folds. */
export const DEFAULT_FOLD_THRESHOLD_MS = 50;

/** Options for {@link foldTimeline}. */
export interface FoldOptions {
  /** Gap threshold before collapsing (default {@link DEFAULT_FOLD_THRESHOLD_MS}). */
  readonly foldThresholdMs?: number;
  /** Ids of folds the operator has expanded. */
  readonly expandedFolds?: ReadonlySet<string>;
}

/** Result of folding a work timeline. */
export interface FoldedTimeline {
  /** Ordered segments (work + folds). */
  readonly segments: readonly TimelineSegment[];
  /** Sum of display weights — denominator for proportional widths. */
  readonly displayDurationMs: number;
  /** Wall-clock span of the whole timeline. */
  readonly wallDurationMs: number;
}

/**
 * Format a duration for fold labels (`7d`, `2h`, `340ms`).
 *
 * @param ms - Duration in milliseconds
 */
export function formatFoldLabel(ms: number): string {
  const abs = Math.max(0, Math.round(ms));
  if (abs < 1000) return `${abs}ms idle`;
  const sec = abs / 1000;
  if (sec < 60) return `${trim(sec)}s idle`;
  const min = sec / 60;
  if (min < 60) return `${trim(min)}m idle`;
  const hr = min / 60;
  if (hr < 48) return `${trim(hr)}h idle`;
  const day = hr / 24;
  return `${trim(day)}d idle`;
}

/**
 * Fold dead time out of a sorted work timeline.
 *
 * @param intervals - Work intervals (any order; sorted internally)
 * @param options - Fold threshold and expansion state
 * @param criticalSpanIds - Spans on the critical path
 */
export function foldTimeline(
  intervals: readonly WorkInterval[],
  options: FoldOptions = {},
  criticalSpanIds: ReadonlySet<string> = new Set(),
): FoldedTimeline {
  const threshold = options.foldThresholdMs ?? DEFAULT_FOLD_THRESHOLD_MS;
  const expanded = options.expandedFolds ?? new Set<string>();
  const sorted = [...intervals].sort((a, b) => a.startMs - b.startMs);

  if (sorted.length === 0) {
    return { segments: [], displayDurationMs: 0, wallDurationMs: 0 };
  }

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  if (!first || !last) {
    return { segments: [], displayDurationMs: 0, wallDurationMs: 0 };
  }

  const wallStart = first.startMs;
  const wallEnd = Math.max(...sorted.map((i) => i.endMs));
  const segments: TimelineSegment[] = [];
  let cursor = wallStart;

  for (const interval of sorted) {
    const gap = interval.startMs - cursor;
    if (gap >= threshold) {
      const foldId = `fold:${cursor}:${interval.startMs}`;
      const isExpanded = expanded.has(foldId);
      const durationMs = gap;
      segments.push({
        kind: "fold",
        id: foldId,
        startMs: cursor,
        endMs: interval.startMs,
        durationMs,
        label: formatFoldLabel(durationMs),
        expanded: isExpanded,
        displayMs: isExpanded ? durationMs : COLLAPSED_FOLD_DISPLAY_MS,
      });
    }

    const durationMs = Math.max(0, interval.endMs - interval.startMs);
    segments.push({
      kind: "work",
      id: interval.id,
      label: interval.label,
      startMs: interval.startMs,
      endMs: interval.endMs,
      durationMs,
      tier: interval.tier,
      spanId: interval.spanId,
      critical: criticalSpanIds.has(interval.spanId),
      failed: interval.failed === true,
      displayMs: Math.max(1, durationMs),
    });
    cursor = Math.max(cursor, interval.endMs);
  }

  const displayDurationMs = segments.reduce((s, seg) => s + seg.displayMs, 0);
  return {
    segments,
    displayDurationMs: Math.max(1, displayDurationMs),
    wallDurationMs: wallEnd - wallStart,
  };
}

/**
 * Build work intervals from spans — one interval per span covering its
 * active wall time. Prefer effect sub-intervals when present so intra-span
 * idle (sleep) can fold too.
 *
 * @param spans - Spans in the open trace
 */
export function intervalsFromSpans(spans: readonly TraceSpan[]): WorkInterval[] {
  const out: WorkInterval[] = [];
  for (const span of spans) {
    if (span.effects.length > 0) {
      for (const e of span.effects) {
        out.push({
          id: `${span.id}:${e.kind}:${e.resource}:${e.timestamp}`,
          label: `${e.kind} ${e.resource}`,
          startMs: e.timestamp,
          endMs: e.timestamp + Math.max(1, e.duration),
          tier: tierOfKind(e.kind),
          spanId: span.id,
          failed: span.errorCode != null && e === span.effects[span.effects.length - 1],
        });
      }
    } else {
      out.push({
        id: span.id,
        label: span.flow,
        startMs: span.startedAt,
        endMs: span.endedAt,
        tier: "none",
        spanId: span.id,
        failed: span.errorCode != null,
      });
    }
  }
  return out;
}

function trim(n: number): string {
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}
