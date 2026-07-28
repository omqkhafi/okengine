/**
 * Format cron health four numbers for display (console §9.6).
 */

import type { ClockCronRecord, CronHealth } from "./types.ts";

/** Display lines for the four health numbers. */
export interface HealthLines {
  readonly drift: string;
  readonly overdue: string;
  readonly missedWithPolicy: string;
  readonly lease: string;
}

/**
 * Format health for a cron row.
 *
 * @param health - Health payload
 */
export function formatHealth(health: CronHealth): HealthLines {
  return {
    drift: health.driftMs == null ? "drift unknown" : `drift ${formatSignedMs(health.driftMs)}`,
    overdue: health.overdue ? "overdue" : "on time",
    missedWithPolicy: `${health.missedRuns} missed · catch-up ${health.catchUp}`,
    lease: health.leaderInstanceId ? `lease ${health.leaderInstanceId}` : "no lease",
  };
}

/**
 * Filter crons by query.
 *
 * @param crons - Cron rows
 * @param q - Query
 */
export function filterCrons(
  crons: readonly ClockCronRecord[],
  q: string,
): readonly ClockCronRecord[] {
  const needle = q.trim().toLowerCase();
  if (!needle) return crons;
  return crons.filter(
    (c) =>
      c.name.toLowerCase().includes(needle) ||
      (c.effectiveCron?.toLowerCase().includes(needle) ?? false) ||
      (c.effectiveEvery?.toLowerCase().includes(needle) ?? false) ||
      c.flowIds.some((id) => id.toLowerCase().includes(needle)),
  );
}

function formatSignedMs(ms: number): string {
  const sign = ms >= 0 ? "+" : "-";
  const abs = Math.abs(ms);
  if (abs < 1_000) return `${sign}${abs}ms`;
  if (abs < 60_000) return `${sign}${Math.round(abs / 1000)}s`;
  return `${sign}${Math.round(abs / 60_000)}m`;
}
