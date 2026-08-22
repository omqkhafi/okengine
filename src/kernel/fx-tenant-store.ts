/**
 * Tenant KV prefix + vault request-time path — lazy chunk.
 *
 * Inlined wrappers would sit on every `createFx` / Store-only `oke()` graph
 * even when `gate.auth.tenant` is off.
 */

import type { KvStoreDecl } from "../elements/store.ts";
import type { VaultRuntime } from "../elements/vault.ts";
import type { Manifest } from "../manifest/types.ts";
import type { SessionCrypto, SessionStore } from "../auth/sessions.ts";
import type { TenantStore } from "../auth/tenants.ts";
import { throwOke } from "./errors.ts";
import type { FxAuthIdentity } from "./fx-auth-keys.ts";
import { bind, type AttachAuthTenantMethodsOptions } from "./fx-auth-tenants.ts";

/**
 * Whether this KV namespace is tenant-prefixed.
 *
 * @param decl - KV store decl
 * @param tenantEnabled - `gate.auth.tenant` is on
 */
export function kvTenantScoped(decl: KvStoreDecl, tenantEnabled: boolean): boolean {
  if (decl.tenantScoped === false) return false;
  if (decl.tenantScoped === true) return true;
  return tenantEnabled;
}

/**
 * Prefix KV args with `{tenantId}:`. Fails loud when no tenant is resolved.
 *
 * @param tenantId - Live `fx.tenant.id`
 * @param decl - KV store decl
 * @param tenantEnabled - Tenancy switch
 * @param prop - Handle method
 * @param args - Original args
 */
export function rewriteKvArgs(
  tenantId: string | null,
  decl: KvStoreDecl,
  tenantEnabled: boolean,
  prop: string | symbol,
  args: unknown[],
): unknown[] {
  if (!kvTenantScoped(decl, tenantEnabled)) return args;
  if (!tenantId) throwOke("TENANT_REQUIRED");
  const prefix = `${tenantId}:`;
  if (prop === "list") {
    const userPrefix = typeof args[0] === "string" ? args[0] : "";
    return [`${prefix}${userPrefix}`];
  }
  if (typeof args[0] !== "string") return args;
  return [`${prefix}${args[0]}`, ...args.slice(1)];
}

/**
 * Strip the tenant prefix from `list()` results.
 *
 * @param tenantId - Live `fx.tenant.id`
 * @param decl - KV store decl
 * @param tenantEnabled - Tenancy switch
 * @param keys - Physical keys
 */
export function stripKvPrefix(
  tenantId: string | null,
  decl: KvStoreDecl,
  tenantEnabled: boolean,
  keys: string[],
): string[] {
  if (!kvTenantScoped(decl, tenantEnabled) || !tenantId) return keys;
  const prefix = `${tenantId}:`;
  return keys.map((k) => (k.startsWith(prefix) ? k.slice(prefix.length) : k));
}

/**
 * Request-time vault path `{tenantId}/{contract}` when the contract is per-tenant.
 *
 * @param tenantId - Live `fx.tenant.id`
 * @param tenantEnabled - Tenancy switch
 * @param contracts - Vault runtime contracts
 * @param contractName - Capability name
 */
export function vaultStoragePath(
  tenantId: string | null,
  tenantEnabled: boolean,
  contracts: VaultRuntime["contracts"] | undefined,
  contractName: string,
): string {
  const decl = contracts?.get(contractName);
  const perTenant =
    decl?.perTenant === true || (tenantEnabled && decl !== undefined && decl.perTenant !== false);
  if (!perTenant) return contractName;
  if (!tenantId) throwOke("TENANT_REQUIRED");
  return `${tenantId}/${contractName}`;
}

/**
 * Compact KV rewrite used by `createFx` so long helper names stay off the
 * Store-only `oke()` graph.
 *
 * @param mode - `in` prefixes args; `out` strips `list()` keys
 * @param tenantId - Live `fx.tenant.id`
 * @param decl - KV store decl
 * @param tenantEnabled - Tenancy switch
 * @param prop - Handle method
 * @param payload - Args or list keys
 */
export function kv(
  mode: "in" | "out",
  tenantId: string | null,
  decl: KvStoreDecl,
  tenantEnabled: boolean,
  prop: string | symbol,
  payload: unknown,
): unknown {
  if (mode === "out") return stripKvPrefix(tenantId, decl, tenantEnabled, payload as string[]);
  return rewriteKvArgs(tenantId, decl, tenantEnabled, prop, payload as unknown[]);
}

/**
 * Compact vault path used by `createFx`.
 *
 * @param tenantId - Live `fx.tenant.id`
 * @param tenantEnabled - Tenancy switch
 * @param contracts - Vault runtime contracts
 * @param contractName - Capability name
 */
export function path(
  tenantId: string | null,
  tenantEnabled: boolean,
  contracts: VaultRuntime["contracts"] | undefined,
  contractName: string,
): string {
  return vaultStoragePath(tenantId, tenantEnabled, contracts, contractName);
}

/**
 * Fail loud when a per-tenant vault row is missing.
 *
 * @param storagePath - Physical `{tenantId}/{contract}` path
 */
export function missingVault(storagePath: string): Error {
  return new Error(`fx.vault.get: missing per-tenant secret "${storagePath}"`);
}

/**
 * Attach tenant auth methods and KV prefixing onto a live `fx` bag.
 * Called from `createFx` only when tenancy is on.
 *
 * @param fx - Mutable fx bag
 * @param ctx - Tenant id + createFx options + gates
 */
export function install(
  fx: {
    auth: FxAuthIdentity;
    store: (ref: never) => object;
  },
  ctx: {
    readonly tenantId: string | null;
    readonly options: {
      readonly tenantStore?: TenantStore;
      readonly tenantEnabled?: boolean;
      readonly sessions?: SessionStore;
      readonly sessionCrypto?: SessionCrypto;
      readonly manifest?: Manifest | null;
    };
    readonly now: () => number;
    readonly gated: AttachAuthTenantMethodsOptions["gated"];
  },
): void {
  const next = bind(
    fx.auth,
    {
      tenantStore: ctx.options.tenantStore,
      sessions: ctx.options.sessions,
      sessionCrypto: ctx.options.sessionCrypto,
      manifest: ctx.options.manifest ?? undefined,
    },
    ctx.now,
    ctx.gated,
  );
  fx.auth = next;
  if (ctx.options.tenantEnabled !== true) return;
  const inner = fx.store;
  (fx as { store: typeof inner }).store = ((ref: never) => {
    const handle = inner(ref);
    if (
      typeof ref === "object" &&
      ref !== null &&
      "facet" in ref &&
      (ref as KvStoreDecl).facet === "kv"
    ) {
      const decl = ref as KvStoreDecl;
      return new Proxy(handle, {
        get(target, prop, receiver) {
          const val = Reflect.get(target, prop, receiver);
          if (typeof val !== "function" || prop === "then") return val;
          return (...args: unknown[]) => {
            const callArgs = rewriteKvArgs(ctx.tenantId, decl, true, prop, args);
            const result = (val as (...a: unknown[]) => unknown).apply(target, callArgs);
            if (prop === "list") {
              return Promise.resolve(result as Promise<string[]>).then((keys) =>
                stripKvPrefix(ctx.tenantId, decl, true, keys),
              );
            }
            return result;
          };
        },
      });
    }
    return handle;
  }) as typeof inner;
}
