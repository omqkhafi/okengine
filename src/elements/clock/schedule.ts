/**
 * Next-occurrence helpers for cron / every schedules (console §9.6 timeline).
 *
 * Supports `every` intervals and simple daily cron (`M H * * *` / `M H * * DOW`).
 * Complex cron expressions fall back to a single `nextRunAt` when present.
 */

import { parseDurationMs } from "./duration.ts";
import { effectiveSchedule, type CronRow } from "./reconcile.ts";

/**
 * Compute fire times in `[from, until)` for a reconciled cron row.
 *
 * @param row - Store row
 * @param from - Inclusive start epoch-ms
 * @param until - Exclusive end epoch-ms
 */
export function nextOccurrences(
  row: CronRow,
  from: number,
  until: number,
): readonly number[] {
  if (row.status !== "active" && row.status !== "paused") return [];
  if (until <= from) return [];

  const sched = effectiveSchedule(row);
  if (sched.every) {
    return nextEveryOccurrences(row, sched.every, from, until);
  }
  if (sched.cron) {
    return nextCronOccurrences(row, sched.cron, sched.timezone, from, until);
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
    // Floor to the slot boundary at or before `at`.
    const origin = row.lastRunAt % interval;
    const slot = at - ((at - origin) % interval);
    return slot > 0 ? slot : null;
  }
  if (sched.cron) {
    const parsed = parseSimpleDaily(sched.cron);
    if (!parsed) return null;
    // Walk back up to 400 days for a prior civil fire.
    for (let day = 1; day <= 400; day++) {
      const probe = at - day * 86_400_000;
      const local = zonedParts(probe, sched.timezone);
      if (local.hour === parsed.hour && local.minute === parsed.minute) {
        // Align to that local wall time's UTC instant near `probe`.
        const fires = civilFiresOnDay(local.date, parsed, sched.timezone);
        const prior = fires.filter((t) => t <= at).pop();
        if (prior !== undefined) return prior;
      }
    }
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
export function countMissedOccurrences(
  row: CronRow,
  from: number,
  until: number,
): number {
  if (until <= from) return 0;
  const sched = effectiveSchedule(row);
  if (sched.every) {
    const interval = parseDurationMs(sched.every);
    if (interval <= 0) return 0;
    return Math.max(0, Math.floor((until - from) / interval) - 0);
  }
  if (sched.cron) {
    // Count fires in (from, until].
    const fires = nextCronOccurrences(row, sched.cron, sched.timezone, from + 1, until + 1);
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
  // If still in the past relative to `from`, advance to first >= from.
  while (t < from) t += interval;
  while (t < until) {
    out.push(t);
    t += interval;
    if (out.length > 10_000) break;
  }
  return out;
}

function nextCronOccurrences(
  row: CronRow,
  cron: string,
  timezone: string,
  from: number,
  until: number,
): readonly number[] {
  const parsed = parseSimpleDaily(cron);
  if (!parsed) {
    if (
      row.nextRunAt !== undefined &&
      row.nextRunAt >= from &&
      row.nextRunAt < until
    ) {
      return [row.nextRunAt];
    }
    return [];
  }

  const out: number[] = [];
  const start = new Date(from);
  for (let day = 0; day < 400; day++) {
    const probe = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + day,
      12,
      0,
      0,
    );
    if (probe > until + 86_400_000) break;
    const local = zonedParts(probe, timezone);
    const fires = civilFiresOnDay(local.date, parsed, timezone);
    for (const t of fires) {
      if (t >= from && t < until) out.push(t);
    }
    if (out.length > 10_000) break;
  }
  return out.sort((a, b) => a - b);
}

/** Parsed simple daily cron. */
interface SimpleDaily {
  readonly minute: number;
  readonly hour: number;
  readonly dow?: number;
}

function parseSimpleDaily(cron: string): SimpleDaily | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parts[0]!;
  const hour = parts[1]!;
  const dom = parts[2]!;
  const mon = parts[3]!;
  const dow = parts[4]!;
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  if (dom !== "*" || mon !== "*") return null;
  const m = Number(minute);
  const h = Number(hour);
  if (m < 0 || m > 59 || h < 0 || h > 23) return null;
  if (dow === "*") return { minute: m, hour: h };
  if (/^\d+$/.test(dow)) {
    const d = Number(dow);
    if (d < 0 || d > 6) return null;
    return { minute: m, hour: h, dow: d };
  }
  return null;
}

function civilFiresOnDay(
  dateStr: string,
  parsed: SimpleDaily,
  timezone: string,
): readonly number[] {
  const matches: number[] = [];
  const base = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(base)) return [];

  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const utc = base + parsed.hour * 3_600_000 + parsed.minute * 60_000 - offsetMin * 60_000;
    const local = zonedParts(utc, timezone);
    if (
      local.date === dateStr &&
      local.hour === parsed.hour &&
      local.minute === parsed.minute
    ) {
      if (parsed.dow !== undefined) {
        const localDow = zonedDow(utc, timezone);
        if (localDow !== parsed.dow) continue;
      }
      if (!matches.includes(utc)) matches.push(utc);
    }
  }
  return matches;
}

interface ZonedParts {
  readonly date: string;
  readonly hour: number;
  readonly minute: number;
}

function zonedParts(utcMs: number, timezone: string): ZonedParts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = fmt.formatToParts(new Date(utcMs));
  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "0";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function zonedDow(utcMs: number, timezone: string): number {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    weekday: "short",
  });
  const w = fmt.format(new Date(utcMs));
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return map[w] ?? 0;
}
