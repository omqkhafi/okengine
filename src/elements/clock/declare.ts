/**
 * Clock declaration — recurring schedules (cron / every).
 *
 * Named clocks are reconciled into the Store at boot; the scheduler reads
 * the effective state from the Store (console §5), never the code directly.
 *
 * Helpers (`clock.daily` · `cron` · `every` · …) compile to the same
 * {@link ClockDecl} shape as `clock(name, { cron })`.
 */

import { clockRegistry } from "../../kernel/element-registries.ts";
import {
  assertValidCronExpression,
  buildCronExpression,
  type CronField,
  type CronFields,
} from "./cron-fields.ts";

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
  /** Optional human description for Console / docs (falls back to the clock name). */
  readonly description?: string;
  /**
   * Expand one `oke_crons` row per tenant (`{name}#{tenantId}`).
   * The bare template name is never ticked.
   */
  readonly perTenant?: boolean;
}

/**
 * Shared options for convenience helpers (no `cron` / `every` — those are
 * supplied by the helper).
 */
export type ClockHelperOptions = Omit<ClockOptions, "cron" | "every">;

/** Options for {@link clock.daily}. */
export type ClockDailyOptions = ClockHelperOptions & {
  /** Wall-clock time (`"06:00"`). Default midnight. */
  readonly at?: string;
};

/** Options for {@link clock.hourly}. */
export type ClockHourlyOptions = ClockHelperOptions & {
  /** Minute of each hour (default `0`). */
  readonly minute?: number;
};

/** Day-of-week token for {@link clock.weekly}. */
export type ClockWeekday = CronField;

/** Options for {@link clock.weekly}. */
export type ClockWeeklyOptions = ClockHelperOptions & {
  /** Day(s) of week (`"mon"` · `1` · `["mon", "fri"]` · `"1-5"`). */
  readonly on: ClockWeekday;
  /** Wall-clock time (default `"00:00"`). */
  readonly at?: string;
};

/** Options for {@link clock.monthly}. */
export type ClockMonthlyOptions = ClockHelperOptions & {
  /** Day(s) of month (`1` · `[1, 15]`). */
  readonly on: CronField;
  /** Wall-clock time (default `"00:00"`). */
  readonly at?: string;
};

/**
 * Structured cron bag + shared helper options for {@link clock.cron}.
 *
 * Schedule keys (`minute` · `hour` · … · `at`) build the expression;
 * remaining keys are {@link ClockHelperOptions}.
 */
export type ClockCronFieldsOptions = CronFields & ClockHelperOptions;

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
  /**
   * When true, `timezone` was omitted at declare and may be replaced by
   * `oke({ clock: { timezone } })` / `defineConfig({ clock: { timezone } })`.
   *
   * @internal
   */
  readonly timezoneDefaulted?: boolean;
  /** Whether Console override is allowed. */
  readonly overridable: boolean;
  /** Optional human description. */
  readonly description?: string;
  /** When true, reconcile expands `{name}#{tenantId}` rows. */
  readonly perTenant?: boolean;
}

/**
 * `clock()` pushes into the shared {@link clockRegistry}
 * (`src/kernel/element-registries.ts`) so {@link oke} can auto-populate
 * `clocks` with zero explicit array — mirrors the {@link on} trigger-drain
 * registry (`src/kernel/on.ts`).
 *
 * Snapshot of every clock declared since the last reset.
 */
export function listClocks(): readonly ClockDecl[] {
  return clockRegistry.slice();
}

/**
 * Clear the clock registry (tests / fresh app adopt).
 *
 * @internal
 */
export function resetClocks(): void {
  clockRegistry.length = 0;
}

/**
 * Declare a named clock / cron schedule.
 *
 * @param name - Schedule name
 * @param options - `cron` and/or `every`, timezone, overridable, perTenant
 */
function declareClock(name: string, options: ClockOptions = {}): ClockDecl {
  if (!options.cron && !options.every) {
    throw new TypeError(`clock("${name}"): require cron or every`);
  }
  if (options.cron) {
    assertValidCronExpression(options.cron, `clock("${name}")`);
  }
  const timezoneDefaulted = options.timezone === undefined;
  const decl: ClockDecl = {
    name,
    cron: options.cron,
    every: options.every,
    timezone: options.timezone ?? "UTC",
    ...(timezoneDefaulted ? { timezoneDefaulted: true } : {}),
    overridable: options.overridable ?? false,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.perTenant === true ? { perTenant: true } : {}),
  };
  clockRegistry.push(decl);
  return decl;
}

/**
 * Apply an app-wide default timezone to clocks that omitted `timezone`.
 *
 * Explicit `timezone: "…"` on a declaration always wins. When `defaultTimezone`
 * is omitted / empty, defaulted clocks stay on `"UTC"`.
 *
 * @param decls - Declared clocks
 * @param defaultTimezone - IANA zone from `oke({ clock })` / config
 */
export function applyClockTimezoneDefaults(
  decls: readonly ClockDecl[],
  defaultTimezone: string | undefined,
): ClockDecl[] {
  const zone = defaultTimezone?.trim();
  if (!zone) return decls.slice();
  return decls.map((d) => {
    if (!d.timezoneDefaulted) return d;
    return {
      name: d.name,
      ...(d.cron !== undefined ? { cron: d.cron } : {}),
      ...(d.every !== undefined ? { every: d.every } : {}),
      timezone: zone,
      overridable: d.overridable,
      ...(d.description !== undefined ? { description: d.description } : {}),
      ...(d.perTenant === true ? { perTenant: true } : {}),
    };
  });
}

/**
 * Per-tenant schedule template — one `oke_crons` row per tenant.
 *
 * @param name - Template name
 * @param options - Same as {@link clock}
 */
function declarePerTenantClock(name: string, options: ClockOptions = {}): ClockDecl {
  return declareClock(name, { ...options, perTenant: true });
}

/**
 * Interval helper — `clock.every("health.ping", "30s")`.
 *
 * @param name - Schedule name
 * @param duration - Interval (`"30s"`, `"1h"`, …)
 * @param options - Timezone / overridable / description / perTenant
 */
function declareEveryClock(
  name: string,
  duration: string,
  options: ClockHelperOptions = {},
): ClockDecl {
  return declareClock(name, { ...options, every: duration });
}

/**
 * Split structured cron fields from shared helper options.
 *
 * @param bag - Mixed `CronFields` + `ClockHelperOptions`
 */
function splitCronBag(bag: ClockCronFieldsOptions): {
  readonly fields: CronFields;
  readonly opts: ClockHelperOptions;
} {
  const {
    minute,
    hour,
    dayOfMonth,
    month,
    dayOfWeek,
    at,
    timezone,
    overridable,
    description,
    perTenant,
  } = bag;
  return {
    fields: {
      ...(minute !== undefined ? { minute } : {}),
      ...(hour !== undefined ? { hour } : {}),
      ...(dayOfMonth !== undefined ? { dayOfMonth } : {}),
      ...(month !== undefined ? { month } : {}),
      ...(dayOfWeek !== undefined ? { dayOfWeek } : {}),
      ...(at !== undefined ? { at } : {}),
    },
    opts: {
      ...(timezone !== undefined ? { timezone } : {}),
      ...(overridable !== undefined ? { overridable } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(perTenant !== undefined ? { perTenant } : {}),
    },
  };
}

/**
 * Cron helper — string expression or structured fields.
 *
 * @param name - Schedule name
 * @param expressionOrFields - Five-field / nickname string, or field bag
 * @param options - Shared options when the second arg is a string
 */
function declareCronClock(
  name: string,
  expressionOrFields: string | ClockCronFieldsOptions,
  options: ClockHelperOptions = {},
): ClockDecl {
  if (typeof expressionOrFields === "string") {
    return declareClock(name, { ...options, cron: expressionOrFields });
  }
  const { fields, opts } = splitCronBag(expressionOrFields);
  const cron = buildCronExpression(fields);
  return declareClock(name, { ...opts, cron });
}

/**
 * Daily preset — midnight unless `at` is set.
 *
 * @param name - Schedule name
 * @param options - `at` + shared options
 */
function declareDailyClock(name: string, options: ClockDailyOptions = {}): ClockDecl {
  const { at, ...opts } = options;
  const cron = buildCronExpression({ at: at ?? "00:00" });
  return declareClock(name, { ...opts, cron });
}

/**
 * Hourly preset — top of the hour unless `minute` is set.
 *
 * @param name - Schedule name
 * @param options - `minute` + shared options
 */
function declareHourlyClock(name: string, options: ClockHourlyOptions = {}): ClockDecl {
  const { minute, ...opts } = options;
  const cron = buildCronExpression({ minute: minute ?? 0 });
  return declareClock(name, { ...opts, cron });
}

/**
 * Weekly / multi-weekday preset.
 *
 * @param name - Schedule name
 * @param options - `on` (required) + optional `at`
 */
function declareWeeklyClock(name: string, options: ClockWeeklyOptions): ClockDecl {
  const { on, at, ...opts } = options;
  const cron = buildCronExpression({
    at: at ?? "00:00",
    dayOfWeek: on,
  });
  return declareClock(name, { ...opts, cron });
}

/**
 * Monthly / multi-DOM preset.
 *
 * @param name - Schedule name
 * @param options - `on` (required) + optional `at`
 */
function declareMonthlyClock(name: string, options: ClockMonthlyOptions): ClockDecl {
  const { on, at, ...opts } = options;
  const cron = buildCronExpression({
    at: at ?? "00:00",
    dayOfMonth: on,
  });
  return declareClock(name, { ...opts, cron });
}

/**
 * Separator between a per-tenant template name and the tenant id.
 */
export const PER_TENANT_CRON_SEP = "#";

/**
 * Physical cron row name for a per-tenant template.
 *
 * @param template - Declared clock name
 * @param tenantId - Tenant id
 */
export function perTenantCronName(template: string, tenantId: string): string {
  return `${template}${PER_TENANT_CRON_SEP}${tenantId}`;
}

/**
 * Parse `{template}#{tenantId}` when `template` is a known per-tenant clock.
 *
 * @param name - Store row name
 * @param templates - Per-tenant template names
 */
export function parsePerTenantCronName(
  name: string,
  templates?: ReadonlySet<string>,
): { readonly template: string; readonly tenantId: string } | null {
  const i = name.lastIndexOf(PER_TENANT_CRON_SEP);
  if (i <= 0) return null;
  const template = name.slice(0, i);
  const tenantId = name.slice(i + 1);
  if (!tenantId) return null;
  if (templates && !templates.has(template)) return null;
  return { template, tenantId };
}

/** Public Clock declaration namespace — callable + convenience helpers. */
export interface ClockNamespace {
  (name: string, options?: ClockOptions): ClockDecl;
  readonly perTenant: typeof declarePerTenantClock;
  readonly every: typeof declareEveryClock;
  readonly cron: typeof declareCronClock;
  readonly daily: typeof declareDailyClock;
  readonly hourly: typeof declareHourlyClock;
  readonly weekly: typeof declareWeeklyClock;
  readonly monthly: typeof declareMonthlyClock;
}

/**
 * Declare a named clock / cron schedule.
 *
 * Helpers: `clock.every` · `clock.cron` · `clock.daily` · `clock.hourly` ·
 * `clock.weekly` · `clock.monthly` · `clock.perTenant`.
 *
 * @param name - Schedule name
 * @param options - `cron` and/or `every`, timezone, overridable
 */
export const clock: ClockNamespace = Object.assign(declareClock, {
  perTenant: declarePerTenantClock,
  every: declareEveryClock,
  cron: declareCronClock,
  daily: declareDailyClock,
  hourly: declareHourlyClock,
  weekly: declareWeeklyClock,
  monthly: declareMonthlyClock,
});
