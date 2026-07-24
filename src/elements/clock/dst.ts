/**
 * DST ambiguity detection — expression + zone together (console §9.6).
 *
 * A daily 02:00 job in a DST-observing zone runs twice or never on
 * transition days. The warning appears only when the schedule actually
 * falls in the ambiguous window.
 */

/** Result when a schedule hits a DST gap or overlap. */
export interface DstAmbiguity {
  /** `"gap"` — spring forward (time skipped); `"overlap"` — fall back (time repeats). */
  readonly kind: "gap" | "overlap";
  /** IANA timezone. */
  readonly timezone: string;
  /** Cron expression that was checked. */
  readonly cron: string;
  /** Local wall time (`HH:MM`) that is ambiguous. */
  readonly localTime: string;
  /** Example transition day (ISO date) where the issue occurs. */
  readonly on: string;
  /** Human-readable reason. */
  readonly reason: string;
}

/**
 * Detect whether a cron expression + timezone falls in a DST ambiguous window.
 *
 * Supports simple forms `M H * * *` (and `M H * * DOW`). Complex lists /
 * steps / ranges return `null` (no spurious always-on warning).
 *
 * @param cron - Five-field cron expression
 * @param timezone - IANA timezone
 * @param from - Optional epoch-ms scan start (defaults to now)
 */
export function detectDstAmbiguity(
  cron: string,
  timezone: string,
  from: number = Date.now(),
): DstAmbiguity | null {
  if (timezone === "UTC" || timezone === "Etc/UTC" || timezone === "GMT") {
    return null;
  }

  const parsed = parseSimpleDaily(cron);
  if (!parsed) return null;

  const { minute, hour } = parsed;
  const start = new Date(from);
  let prevOffset: number | null = null;

  // Walk day-by-day; only classify on days where the noon offset jumps
  // (DST transition). Keeps the warning precise without a full-year grind.
  for (let day = 0; day < 450; day++) {
    const probe = Date.UTC(
      start.getUTCFullYear(),
      start.getUTCMonth(),
      start.getUTCDate() + day,
      12,
      0,
      0,
    );
    const offset = offsetMinutesAt(probe, timezone);
    if (prevOffset !== null && offset !== prevOffset) {
      // Transition occurred between yesterday noon and today noon —
      // check both civil dates around the jump.
      for (const delta of [-1, 0] as const) {
        const t = new Date(probe + delta * 86_400_000);
        const y = t.getUTCFullYear();
        const mo = t.getUTCMonth() + 1;
        const d = t.getUTCDate();
        const dateStr = `${y}-${pad(mo)}-${pad(d)}`;
        const kind = classifyLocalInstant(dateStr, hour, minute, timezone);
        if (kind === "gap" || kind === "overlap") {
          const localTime = `${pad(hour)}:${pad(minute)}`;
          return {
            kind,
            timezone,
            cron: cron.trim(),
            localTime,
            on: dateStr,
            reason:
              kind === "gap"
                ? `${localTime} in ${timezone} is skipped on ${dateStr} (DST spring forward)`
                : `${localTime} in ${timezone} occurs twice on ${dateStr} (DST fall back)`,
          };
        }
      }
    }
    prevOffset = offset;
  }
  return null;
}

/** Parsed simple daily cron. */
interface SimpleDaily {
  readonly minute: number;
  readonly hour: number;
}

function parseSimpleDaily(cron: string): SimpleDaily | null {
  const parts = cron.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const minute = parts[0]!;
  const hour = parts[1]!;
  const dom = parts[2]!;
  const mon = parts[3]!;
  // Only flag when the schedule pins a specific local wall-clock time.
  if (!/^\d+$/.test(minute) || !/^\d+$/.test(hour)) return null;
  if (dom !== "*" && !/^\d+$/.test(dom)) return null;
  if (mon !== "*" && !/^\d+$/.test(mon)) return null;
  const m = Number(minute);
  const h = Number(hour);
  if (m < 0 || m > 59 || h < 0 || h > 23) return null;
  return { minute: m, hour: h };
}

/**
 * Classify a local civil time in `timezone` on `YYYY-MM-DD`.
 *
 * - `ok` — exactly one UTC instant
 * - `gap` — no UTC instant (spring forward)
 * - `overlap` — two UTC instants (fall back)
 */
function classifyLocalInstant(
  dateStr: string,
  hour: number,
  minute: number,
  timezone: string,
): "ok" | "gap" | "overlap" {
  const matches: number[] = [];
  const base = Date.parse(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(base)) return "ok";

  for (let offsetMin = -14 * 60; offsetMin <= 14 * 60; offsetMin += 15) {
    const utc = base + hour * 3_600_000 + minute * 60_000 - offsetMin * 60_000;
    const local = formatInZone(utc, timezone);
    if (
      local.date === dateStr &&
      local.hour === hour &&
      local.minute === minute
    ) {
      if (!matches.includes(utc)) matches.push(utc);
    }
  }

  if (matches.length === 0) return "gap";
  if (matches.length >= 2) return "overlap";
  return "ok";
}

/** UTC offset (minutes) of `timezone` at `utcMs`. */
function offsetMinutesAt(utcMs: number, timezone: string): number {
  const local = formatInZone(utcMs, timezone);
  // Reconstruct a UTC ms for the same wall clock as if it were UTC, then diff.
  const asUtc = Date.UTC(
    Number(local.date.slice(0, 4)),
    Number(local.date.slice(5, 7)) - 1,
    Number(local.date.slice(8, 10)),
    local.hour,
    local.minute,
    0,
  );
  return Math.round((asUtc - utcMs) / 60_000);
}

interface ZonedParts {
  readonly date: string;
  readonly hour: number;
  readonly minute: number;
}

function formatInZone(utcMs: number, timezone: string): ZonedParts {
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
  const year = get("year");
  const month = get("month");
  const day = get("day");
  return {
    date: `${year}-${month}-${day}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}
