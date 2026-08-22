/**
 * Clock declaration — recurring schedules (cron / every).
 *
 * Named clocks are reconciled into the Store at boot; the scheduler reads
 * the effective state from the Store (console §5), never the code directly.
 */

import { clockRegistry } from "../../kernel/element-registries.ts";

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
  const decl: ClockDecl = {
    name,
    cron: options.cron,
    every: options.every,
    timezone: options.timezone ?? "UTC",
    overridable: options.overridable ?? false,
    ...(options.description !== undefined ? { description: options.description } : {}),
    ...(options.perTenant === true ? { perTenant: true } : {}),
  };
  clockRegistry.push(decl);
  return decl;
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

/**
 * Declare a named clock / cron schedule.
 *
 * @param name - Schedule name
 * @param options - `cron` and/or `every`, timezone, overridable
 */
export const clock: ((name: string, options?: ClockOptions) => ClockDecl) & {
  readonly perTenant: typeof declarePerTenantClock;
} = Object.assign(declareClock, { perTenant: declarePerTenantClock });
