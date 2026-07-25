/**
 * Forward timeline helpers — next 24h list, not a grid (console §9.6).
 */

import type { TimelineEvent } from "./types.ts";

/**
 * Filter timeline events to those within the next 24h from `now`.
 *
 * @param events - Timeline events
 * @param now - Anchor epoch-ms
 */
export function forwardTimeline(
  events: readonly TimelineEvent[],
  now: number,
): readonly TimelineEvent[] {
  const until = now + 24 * 60 * 60 * 1000;
  return events
    .filter((e) => e.at >= now && e.at < until)
    .slice()
    .sort((a, b) => a.at - b.at || a.name.localeCompare(b.name));
}

/**
 * Format an absolute time relative to `now` for the timeline row.
 *
 * @param at - Event epoch-ms
 * @param now - Anchor
 */
export function formatTimelineWhen(at: number, now: number): string {
  const delta = at - now;
  if (delta < 0) return "past";
  if (delta < 60_000) return `in ${Math.round(delta / 1000)}s`;
  if (delta < 3_600_000) return `in ${Math.round(delta / 60_000)}m`;
  if (delta < 86_400_000) {
    const h = Math.floor(delta / 3_600_000);
    const m = Math.round((delta % 3_600_000) / 60_000);
    return m > 0 ? `in ${h}h ${m}m` : `in ${h}h`;
  }
  return new Date(at).toISOString();
}
