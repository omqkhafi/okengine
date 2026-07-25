/**
 * Cron health — four numbers for the Console Clock panel (console §9.6).
 *
 * Catch-up policy is `"one"`: the runtime fires at most once per lease when
 * overdue (`ClockRuntime.tick` / `fire`). Not a Store column.
 */

import { parseDurationMs } from "./duration.ts";
import { effectiveSchedule, type CronRow } from "./reconcile.ts";
import {
  countMissedOccurrences,
  previousOccurrence,
} from "./schedule.ts";

/** Catch-up policy matching ClockRuntime physics. */
export type CatchUpPolicy = "one";

/** Four-number cron health (+ lease holder). */
export interface CronHealth {
  /** Scheduled vs actual (`lastRunAt - expected`); `null` when unknown. */
  readonly driftMs: number | null;
  /** Whether the schedule is past due. */
  readonly overdue: boolean;
  /** Runs missed while the app was down (slots between last fire and now). */
  readonly missedRuns: number;
  /** Runtime catch-up policy (`"one"`). */
  readonly catchUp: CatchUpPolicy;
  /** Instance holding the leader lease, if any. */
  readonly leaderInstanceId?: string;
  /** Lease expiry epoch-ms. */
  readonly leaderLeaseUntil?: number;
}

/**
 * Compute cron health from a reconciled Store row.
 *
 * @param row - `oke_crons` row
 * @param now - Current epoch-ms
 */
export function cronHealth(row: CronRow, now: number): CronHealth {
  const overdue = isOverdue(row, now);
  const missedRuns = overdue
    ? countMissedFromRow(row, now)
    : 0;
  const driftMs = computeDrift(row, now);

  return {
    driftMs,
    overdue,
    missedRuns,
    catchUp: "one",
    leaderInstanceId: row.leaderInstanceId,
    leaderLeaseUntil: row.leaderLeaseUntil,
  };
}

/**
 * @param row - Store row
 * @param now - Clock
 */
function isOverdue(row: CronRow, now: number): boolean {
  if (row.status !== "active") return false;
  if (row.nextRunAt !== undefined) return row.nextRunAt < now;
  const sched = effectiveSchedule(row);
  if (sched.every) {
    const interval = parseDurationMs(sched.every);
    if (interval <= 0) return false;
    if (row.lastRunAt === undefined) return true;
    return row.lastRunAt + interval < now;
  }
  return false;
}

function countMissedFromRow(row: CronRow, now: number): number {
  const sched = effectiveSchedule(row);
  if (sched.every) {
    const interval = parseDurationMs(sched.every);
    if (interval <= 0) return 0;
    if (row.lastRunAt === undefined) return 1;
    const elapsed = now - row.lastRunAt;
    return Math.max(0, Math.floor(elapsed / interval));
  }
  if (row.lastRunAt !== undefined) {
    return countMissedOccurrences(row, row.lastRunAt, now);
  }
  if (row.nextRunAt !== undefined && row.nextRunAt < now) return 1;
  return 0;
}

function computeDrift(row: CronRow, now: number): number | null {
  if (row.lastRunAt === undefined) return null;
  const expected = previousOccurrence(row, row.lastRunAt);
  if (expected === null) {
    // Fallback: for `every`, expected is lastRunAt floored to interval from origin.
    const sched = effectiveSchedule(row);
    if (sched.every) {
      const interval = parseDurationMs(sched.every);
      if (interval <= 0) return null;
      // If nextRunAt is set, expected previous = nextRunAt - interval.
      if (row.nextRunAt !== undefined) {
        return row.lastRunAt - (row.nextRunAt - interval);
      }
      // No better anchor — drift unknown unless overdue.
      if (row.lastRunAt + interval < now) {
        return now - (row.lastRunAt + interval);
      }
      return 0;
    }
    return null;
  }
  return row.lastRunAt - expected;
}
