/**
 * `gate.auth.tenant` config — identity dimension opt-in.
 */

/** How the request names a tenant. */
export type TenantSource = "claim" | "header" | "subdomain" | "resolve";

/** Public `gate.auth.tenant` bag (boolean shorthand or options). */
export interface TenantAuthOptions {
  /**
   * Pure B2B: every user-plane request needs a tenant.
   * Default `false` (B2C+B2B coexistence).
   */
  readonly required?: boolean;
  /** Resolution source. Default `"claim"`. */
  readonly source?: TenantSource;
  /** Header name for `source: "header"`. Default `x-oke-tenant`. */
  readonly header?: string;
  /**
   * Tier-3 escape hatch. When it returns an id, membership is still
   * checked unless {@link TenantAuthOptions.authoritative} is true.
   */
  readonly resolve?: (ctx: TenantResolveContext) => string | null | undefined;
  /**
   * When true, {@link TenantAuthOptions.resolve} is trusted without a
   * membership query. Default false (fail-safe).
   */
  readonly authoritative?: boolean;
}

/** Context passed to {@link TenantAuthOptions.resolve}. */
export interface TenantResolveContext {
  readonly auth: {
    readonly userId: string | null;
    readonly tenantId?: string | null;
  };
  readonly request?: Request;
  readonly claimTenantId: string | null;
}

/** Fully resolved tenant auth config. */
export interface ResolvedTenantAuth {
  readonly enabled: true;
  readonly required: boolean;
  readonly source: TenantSource;
  readonly header: string;
  readonly resolve?: TenantAuthOptions["resolve"];
  readonly authoritative: boolean;
}

/**
 * Normalize `gate.auth.tenant`.
 *
 * @param input - `true` or options bag
 */
export function resolveTenantAuth(input: true | TenantAuthOptions): ResolvedTenantAuth {
  if (input === true) {
    return {
      enabled: true,
      required: false,
      source: "claim",
      header: "x-oke-tenant",
      authoritative: false,
    };
  }
  return {
    enabled: true,
    required: input.required === true,
    source: input.source ?? "claim",
    header: input.header ?? "x-oke-tenant",
    ...(input.resolve !== undefined ? { resolve: input.resolve } : {}),
    authoritative: input.authoritative === true,
  };
}
