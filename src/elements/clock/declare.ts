/**
 * Clock declaration — recurring schedules (cron / every).
 *
 * Named clocks are reconciled into the Store at boot; the scheduler reads
 * the effective state from the Store (console §5), never the code directly.
 */

/** Options for {@link clock}. */
export interface ClockOptions {
  /** Cron expression (`m h dom mon dow`). */
  readonly cron?: string;
  /** Fixed interval (`"10m"`, `"1h"`). */
  readonly every?: string;
  /** IANA timezone (defaults to `"UTC"`). */
  readonly timezone?: string;
  /**
   * When true, the Console may override the schedule in the Store.
   * Without it, no override is possible (console §4.1).
   */
  readonly overridable?: boolean;
}

/**
 * Declared clock handle — reconciled into `oke_crons` at boot.
 */
export interface ClockDecl {
  /** Schedule name (manifest / store key). */
  readonly name: string;
  /** Cron expression when declared. */
  readonly cron?: string;
  /** Interval when declared. */
  readonly every?: string;
  /** IANA timezone. */
  readonly timezone: string;
  /** Whether Console override is allowed. */
  readonly overridable: boolean;
}

/**
 * Declare a named clock / cron schedule.
 *
 * @param name - Schedule name
 * @param options - `cron` and/or `every`, timezone, overridable
 */
export function clock(name: string, options: ClockOptions = {}): ClockDecl {
  if (!options.cron && !options.every) {
    throw new TypeError(`clock("${name}"): require cron or every`);
  }
  return {
    name,
    cron: options.cron,
    every: options.every,
    timezone: options.timezone ?? "UTC",
    overridable: options.overridable ?? false,
  };
}
