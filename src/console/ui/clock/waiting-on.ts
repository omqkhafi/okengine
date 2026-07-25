/**
 * Waiting-on list helpers — sleeping durable runs from the journal.
 */

import type { WaitingOnCount, WaitingOnRecord } from "./types.ts";

/**
 * Aggregate waiting-on rows by sleep label (UI mirror of server counts).
 *
 * @param rows - Waiting-on rows
 */
export function aggregateByLabel(
  rows: readonly WaitingOnRecord[],
): readonly WaitingOnCount[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    const label = r.label || "(unlabelled)";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Banner summary: "3 sleeping — 2 trial-period, 1 verify-window".
 *
 * @param total - Total sleeping
 * @param counts - Per-label counts
 */
export function waitingOnBanner(
  total: number,
  counts: readonly WaitingOnCount[],
): string {
  if (total === 0) return "Nothing waiting";
  const parts = counts
    .slice(0, 4)
    .map((c) => `${c.count} ${c.label}`)
    .join(", ");
  return `${total} sleeping — ${parts}`;
}

/**
 * Format wake-in duration.
 *
 * @param ms - Milliseconds until wake
 */
export function formatWakeIn(ms: number): string {
  if (ms <= 0) return "due";
  if (ms < 1_000) return `${ms}ms`;
  const sec = Math.floor(ms / 1_000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 48) {
    const rem = min % 60;
    return rem > 0 ? `${hr}h ${rem}m` : `${hr}h`;
  }
  const days = Math.floor(hr / 24);
  return `${days}d`;
}

/**
 * Filter waiting-on by query string.
 *
 * @param rows - Rows
 * @param q - Query
 */
export function filterWaitingOn(
  rows: readonly WaitingOnRecord[],
  q: string,
): readonly WaitingOnRecord[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return rows;
  return rows.filter(
    (r) =>
      r.label.toLowerCase().includes(needle) ||
      r.flow.toLowerCase().includes(needle) ||
      r.runId.toLowerCase().includes(needle) ||
      (r.step?.toLowerCase().includes(needle) ?? false),
  );
}
