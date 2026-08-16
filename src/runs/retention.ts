/**
 * Runs Parquet retention — delete partitions older than `keep`.
 */

import { parseDurationMs } from "../elements/clock/duration.ts";

/**
 * Parse {@link import("./types.ts").RunsRetention.keep} into milliseconds.
 * `"forever"` / unset / unparseable → `null` (no deletion).
 *
 * @param keep - Duration or `"forever"`
 */
export function retentionKeepMs(keep: string | undefined): number | null {
  if (keep === undefined || keep === "forever") return null;
  const ms = parseDurationMs(keep);
  return ms > 0 ? ms : null;
}

/**
 * Extract the UTC partition day from a runs object key.
 *
 * @param key - Object key (`runs/day=YYYY-MM-DD/…`)
 */
export function partitionDayFromKey(key: string): string | undefined {
  const match = /day=(\d{4}-\d{2}-\d{2})/.exec(key);
  return match?.[1];
}

/**
 * Whether a Parquet partition is older than the keep window.
 *
 * @param key - Object key
 * @param now - Epoch-ms
 * @param keepMs - Keep window
 */
export function shouldDropPartition(key: string, now: number, keepMs: number): boolean {
  const day = partitionDayFromKey(key);
  if (!day) return false;
  const start = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(start)) return false;
  return now - start > keepMs;
}
