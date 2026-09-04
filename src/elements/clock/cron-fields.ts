/**
 * Structured cron field bag → five-field expression.
 *
 * Used by `clock.cron` / `clock.daily` / … so Manifest + Store still store a
 * plain cron string. Only Bun five-field + nicknames — no Quartz calendars.
 */

/** One cron field: scalar, step/range string, or list. */
export type CronField = number | string | readonly (number | string)[];

/**
 * Structured schedule fields for {@link buildCronExpression}.
 *
 * Omit a field to leave it `*`. `at: "HH:MM"` sets minute + hour when those
 * are unset.
 */
export interface CronFields {
  /** Minute (`0` · `[0, 30]` · step string like every-15). */
  readonly minute?: CronField;
  /** Hour (`9` · `[9, 12, 17]` · `"9-17"`). */
  readonly hour?: CronField;
  /** Day of month (`1` · `[1, 15]` · `"1-7"`). */
  readonly dayOfMonth?: CronField;
  /** Month (`1` · `[1, 6]` · step string). */
  readonly month?: CronField;
  /** Day of week (`1` · `"mon"` · `["mon", "fri"]` · `"1-5"`). */
  readonly dayOfWeek?: CronField;
  /** Wall-clock sugar `"HH:MM"` / `"H:MM"` → minute + hour when unset. */
  readonly at?: string;
}

const DAY_NAME_TO_NUM: Readonly<Record<string, number>> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

/**
 * Parse `at: "06:00"` / `"6:00"` into `{ minute, hour }`.
 *
 * @param at - Wall-clock string
 * @throws TypeError when the format is invalid
 */
export function parseAtTime(at: string): { readonly minute: number; readonly hour: number } {
  const trimmed = at.trim();
  const m = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!m) {
    throw new TypeError(`cron at: expected "HH:MM", got ${JSON.stringify(at)}`);
  }
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    throw new TypeError(`cron at: hour must be 0–23, got ${JSON.stringify(at)}`);
  }
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new TypeError(`cron at: minute must be 0–59, got ${JSON.stringify(at)}`);
  }
  return { hour, minute };
}

/**
 * Normalize one field token (day names → 0–6; numbers → string).
 *
 * @param value - Scalar field piece
 * @param kind - Which cron slot (day names only apply to `dayOfWeek`)
 */
function normalizeToken(value: number | string, kind: "dayOfWeek" | "other"): string {
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError(`cron field: expected integer, got ${value}`);
    }
    return String(value);
  }
  const trimmed = value.trim();
  if (!trimmed) {
    throw new TypeError("cron field: empty string");
  }
  if (kind === "dayOfWeek") {
    const lower = trimmed.toLowerCase();
    const mapped = DAY_NAME_TO_NUM[lower];
    if (mapped !== undefined) return String(mapped);
  }
  return trimmed;
}

/**
 * Serialize one cron field to a crontab token (`*` when omitted).
 *
 * @param field - Optional structured field
 * @param kind - Slot kind for day-name mapping
 */
export function serializeCronField(
  field: CronField | undefined,
  kind: "dayOfWeek" | "other" = "other",
): string {
  if (field === undefined) return "*";
  if (Array.isArray(field)) {
    if (field.length === 0) {
      throw new TypeError("cron field: empty list");
    }
    return field.map((v) => normalizeToken(v as number | string, kind)).join(",");
  }
  return normalizeToken(field as number | string, kind);
}

/**
 * Whether the bag has any schedule signal (fields or `at`).
 *
 * @param fields - Structured bag
 */
function hasScheduleSignal(fields: CronFields): boolean {
  return (
    fields.at !== undefined ||
    fields.minute !== undefined ||
    fields.hour !== undefined ||
    fields.dayOfMonth !== undefined ||
    fields.month !== undefined ||
    fields.dayOfWeek !== undefined
  );
}

/**
 * Build a five-field cron expression from structured fields.
 *
 * @param fields - Field bag (`at` + minute/hour/dom/mon/dow)
 * @throws TypeError when empty or `at` is invalid
 */
export function buildCronExpression(fields: CronFields): string {
  if (!hasScheduleSignal(fields)) {
    throw new TypeError("cron fields: require at least one of at, minute, hour, dayOfMonth, month, dayOfWeek");
  }

  let minute = fields.minute;
  let hour = fields.hour;
  if (fields.at !== undefined) {
    const parsed = parseAtTime(fields.at);
    if (minute === undefined) minute = parsed.minute;
    if (hour === undefined) hour = parsed.hour;
  }

  return [
    serializeCronField(minute),
    serializeCronField(hour),
    serializeCronField(fields.dayOfMonth),
    serializeCronField(fields.month),
    serializeCronField(fields.dayOfWeek, "dayOfWeek"),
  ].join(" ");
}

/**
 * Assert `Bun.cron.parse` accepts the expression (fail loud at declare).
 *
 * @param expression - Five-field cron or Bun nickname
 * @param label - Error prefix (clock name / helper)
 */
export function assertValidCronExpression(expression: string, label: string): void {
  try {
    (
      Bun.cron.parse as (
        expression: string,
        relativeDate?: Date | number,
        options?: { readonly tz?: string },
      ) => Date | null
    )(expression, Date.now(), { tz: "UTC" });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TypeError(`${label}: invalid cron ${JSON.stringify(expression)} (${msg})`);
  }
}
