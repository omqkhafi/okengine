/**
 * Next-occurrence helpers for cron / every schedules (console §9.6 timeline).
 *
 * Cron math uses {@link Bun.cron.parse} (5-field + nicknames + `{ tz }`).
 * Interval (`every`) stays on {@link parseDurationMs}.
 */

import { parseDurationMs } from "./duration.ts";
import { effectiveSchedule, type CronRow } from "./reconcile.ts";

/**
 * Bun 1.4 `{ tz }` parse — `@types/bun` 1.3.14 only declares two arguments.
 *
 * @param expression - 5-field expression or nickname
 * @param relativeMs - Exclusive start
 * @param timezone - IANA zone
 */
function parseCronNext(expression: string, relativeMs: number, timezone: string): Date | null {
  return (
    Bun.cron.parse as (
      expression: string,
      relativeDate?: Date | number,
      options?: { readonly tz?: string },
    ) => Date | null
  )(expression, relativeMs, { tz: timezone });
}

/** Cap walk loops so a `* * * * *` range cannot hang the Console timeline. */
const MAX_CRON_FIRES = 10_000;
/** How far back {@link previousOccurrence} searches for a prior cron fire. */
const PREVIOUS_LOOKBACK_MS = 400 * 86_400_000;

/**
 * Next matching UTC epoch-ms after `relativeMs`, or `undefined` when the
 * expression is invalid or has no match within eight years.
 *
 * {@link Bun.cron.parse} is exclusive of `relativeMs`.
 *
 * @param cron - 5-field expression or nickname (`@hourly`)
 * @param relativeMs - Search starts after this instant
 * @param timezone - IANA zone passed as `{ tz }`
 */
export function nextCronFireAt(
  cron: string,
  relativeMs: number,
  timezone: string,
): number | undefined {
  try {
    const next = parseCronNext(cron, relativeMs, timezone);
    return next === null ? undefined : next.getTime();
  } catch {
    return undefined;
  }
}

/**
 * Compute fire times in `[from, until)` for a reconciled cron row.
 *
 * @param row - Store row
 * @param from - Inclusive start epoch-ms
 * @param until - Exclusive end epoch-ms
 */
export function nextOccurrences(row: CronRow, from: number, until: number): readonly number[] {
  if (row.status !== "active" && row.status !== "paused") return [];
  if (until <= from) return [];

  const sched = effectiveSchedule(row);
  if (sched.every) {
    return nextEveryOccurrences(row, sched.every, from, until);
  }
  if (sched.cron) {
    return nextCronOccurrences(sched.cron, row.timezone, from, until);
  }
  return [];
}

/**
 * Expected previous fire before `at` (for drift), or `null` when unknown.
 *
 * @param row - Store row
 * @param at - Anchor epoch-ms (usually `lastRunAt` or `now`)
 */
export function previousOccurrence(row: CronRow, at: number): number | null {
  const sched = effectiveSchedule(row);
  if (sched.every) {
    const interval = parseDurationMs(sched.every);
    if (interval <= 0) return null;
    if (row.lastRunAt === undefined) return null;
    const origin = row.lastRunAt % interval;
    const slot = at - ((at - origin) % interval);
    return slot > 0 ? slot : null;
  }
  if (sched.cron) {
    return previousCronFire(sched.cron, row.timezone, at);
  }
  return null;
}

/**
 * Count schedule slots strictly after `from` and at or before `until`.
 *
 * @param row - Store row
 * @param from - Exclusive lower bound (usually lastRunAt)
 * @param until - Inclusive upper bound (usually now)
 */
export function countMissedOccurrences(row: CronRow, from: number, until: number): number {
  if (until <= from) return 0;
  const sched = effectiveSchedule(row);
  if (sched.every) {
    const interval = parseDurationMs(sched.every);
    if (interval <= 0) return 0;
    return Math.max(0, Math.floor((until - from) / interval));
  }
  if (sched.cron) {
    const fires = nextCronOccurrences(sched.cron, row.timezone, from + 1, until + 1);
    return fires.filter((t) => t > from && t <= until).length;
  }
  return 0;
}

function nextEveryOccurrences(
  row: CronRow,
  every: string,
  from: number,
  until: number,
): readonly number[] {
  const interval = parseDurationMs(every);
  if (interval <= 0) return [];
  const out: number[] = [];
  let t =
    row.nextRunAt !== undefined && row.nextRunAt >= from
      ? row.nextRunAt
      : row.lastRunAt !== undefined
        ? row.lastRunAt + interval
        : from;
  while (t < from) t += interval;
  while (t < until) {
    out.push(t);
    t += interval;
    if (out.length > MAX_CRON_FIRES) break;
  }
  return out;
}

function nextCronOccurrences(
  cron: string,
  timezone: string,
  from: number,
  until: number,
): readonly number[] {
  const out: number[] = [];
  // parse is exclusive of the cursor — step back 1ms so `from` itself can match.
  let cursor = from - 1;
  while (out.length < MAX_CRON_FIRES) {
    const t = nextCronFireAt(cron, cursor, timezone);
    if (t === undefined || t >= until) break;
    if (t >= from) out.push(t);
    cursor = t;
  }
  return out;
}

function previousCronFire(cron: string, timezone: string, at: number): number | null {
  let cursor = at - PREVIOUS_LOOKBACK_MS;
  let prev: number | null = null;
  let steps = 0;
  while (steps < MAX_CRON_FIRES) {
    const t = nextCronFireAt(cron, cursor, timezone);
    if (t === undefined || t >= at) break;
    prev = t;
    cursor = t;
    steps++;
  }
  return prev;
}
