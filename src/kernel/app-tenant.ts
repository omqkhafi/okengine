/**
 * App-shell tenancy wiring — lazy chunk.
 *
 * One `w` dispatcher so Store-only `oke()` graphs do not spell Clock /
 * pipeline tenant field names.
 */

import type { ResolvedTenantAuth } from "../auth/tenant-config.ts";
import type { TenantStore } from "../auth/tenants.ts";
import type { ClockDecl } from "../elements/clock/declare.ts";
import { parsePerTenantCronName } from "./clock-per-tenant-name.ts";
import { orphanPerTenantCronRows, putPerTenantCronRows } from "./clock-reconcile.ts";
import type { AnyFlowDef } from "./flow.ts";
import type { PipelineTenantDeps } from "./pipeline.ts";

function cron(name: string): { readonly tenant: { readonly id: string } } | undefined {
  const parsed = parsePerTenantCronName(name);
  return parsed ? { tenant: { id: parsed.tenantId } } : undefined;
}

function boot(store: TenantStore): { readonly tenantIds: () => string[] } {
  return { tenantIds: () => [...store.tenants.keys()] };
}

function clock(
  tenantStore: TenantStore,
  clockStore: Parameters<typeof putPerTenantCronRows>[0],
  templates: readonly ClockDecl[],
): void {
  tenantStore.hooks = {
    onCreate: (row) => putPerTenantCronRows(clockStore, templates, row.id),
    onDelete: (row) => orphanPerTenantCronRows(clockStore, templates, row.id),
  };
}

function resume(auth: { readonly tenant?: unknown; readonly tenantStore?: TenantStore }): {
  readonly tenantEnabled: boolean;
  readonly tenantStore: TenantStore | undefined;
} {
  return {
    tenantEnabled: auth.tenant !== undefined,
    tenantStore: auth.tenantStore,
  };
}

function pipe(
  tenant: ResolvedTenantAuth,
  store: TenantStore,
  flowTenantScoped: boolean,
  flowPlane: AnyFlowDef["plane"],
): { readonly tenant: PipelineTenantDeps } {
  return {
    tenant: {
      config: tenant,
      store,
      flowTenantScoped,
      flowPlane,
    },
  };
}

function fx(args: {
  readonly enabled: boolean;
  readonly store: TenantStore | undefined;
  readonly scoped: boolean;
  readonly plane: AnyFlowDef["plane"];
  readonly tenant: { readonly id: string | null } | undefined;
  readonly bind?: { readonly secret: string; readonly now: () => number };
}): {
  readonly tenantStore: TenantStore | undefined;
  readonly tenantEnabled: boolean;
  readonly flowTenantScoped: boolean;
  readonly flowPlane: AnyFlowDef["plane"];
  readonly sessionCrypto?: { readonly secret: string; readonly now: () => number };
  readonly tenant?: { readonly id: string | null };
} {
  return {
    tenantStore: args.store,
    tenantEnabled: args.enabled,
    flowTenantScoped: args.scoped,
    flowPlane: args.plane,
    ...(args.bind ? { sessionCrypto: { secret: args.bind.secret, now: args.bind.now } } : {}),
    ...(args.tenant ? { tenant: args.tenant } : {}),
  };
}

/**
 * Dispatch tenancy wiring.
 *
 * 0 cron · 1 boot · 2 clock · 3 pipe · 4 fx · 5 resume
 *
 * @param kind - Operation
 * @param args - Kind-specific arguments
 */
export function w(kind: number, ...args: unknown[]): unknown {
  switch (kind) {
    case 0:
      return cron(args[0] as string);
    case 1:
      return boot(args[0] as TenantStore);
    case 2:
      clock(
        args[0] as TenantStore,
        args[1] as Parameters<typeof putPerTenantCronRows>[0],
        args[2] as readonly ClockDecl[],
      );
      return undefined;
    case 3:
      return pipe(
        args[0] as ResolvedTenantAuth,
        args[1] as TenantStore,
        args[2] as boolean,
        args[3] as AnyFlowDef["plane"],
      );
    case 4:
      return fx(args[0] as Parameters<typeof fx>[0]);
    case 5:
      return resume(args[0] as Parameters<typeof resume>[0]);
    default:
      return undefined;
  }
}
