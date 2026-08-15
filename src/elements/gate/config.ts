/**
 * `oke({ gate })` — nested Gate bag (auth · policies · rate · posture).
 *
 * Auth resolution is sync-lazy via {@link requirePackageModule} so HTTP-only
 * apps never evaluate `auth/config` (and so `dist/` can ship a separate chunk).
 */

import type { GateAuthOptions, ResolvedGateAuth } from "../../auth/config.ts";
import { requirePackageModule } from "../../shared/lazy-src.ts";
import type { GateDecl } from "./declare.ts";
import { flattenGateMembers, isGateAllDecl, type GateAllDecl } from "./flatten.ts";

/** Rate-limit defaults under Gate. */
export interface GateRateLimitOptions {
  /** When true, auth Flows attach stricter rate presets (default true when auth enabled). */
  readonly enabled?: boolean;
}

/**
 * Nested Gate options for {@link oke}.
 *
 * Replaces root `auth` / `gates` / `unguardedHttp`.
 */
export interface GateOptions {
  /** Builtin hybrid-session auth + core Flows under `basePath`. */
  readonly auth?: GateAuthOptions;
  /** Named policy / rate declarations (or `gate.all` handles) for the Gate runtime. */
  readonly policies?: readonly (GateDecl | GateAllDecl)[];
  /** Global rate-limit posture (auth path presets). */
  readonly rateLimit?: GateRateLimitOptions;
  /**
   * HTTP auth-posture enforcement at boot.
   * Default `"deny"`. `"allow"` is honoured only when `env === "test"`.
   */
  readonly unguardedHttp?: "deny" | "allow";
}

/** Fully resolved Gate config consumed by `oke` / boot. */
export interface ResolvedGateConfig {
  readonly auth: ResolvedGateAuth | undefined;
  readonly policies: readonly GateDecl[];
  readonly rateLimitEnabled: boolean;
  readonly unguardedHttp: "deny" | "allow";
}

/** Options for {@link resolveGateConfig}. */
export interface ResolveGateConfigOptions {
  readonly gate?: GateOptions;
  readonly env?: string;
}

/**
 * Expand `gate.all` handles in a policies bag to policy / rate decls.
 *
 * @param policies - Mixed decls and `all` handles
 */
export function flattenGatePolicies(policies: readonly (GateDecl | GateAllDecl)[]): GateDecl[] {
  const out: GateDecl[] = [];
  for (const item of policies) {
    if (isGateAllDecl(item)) out.push(...flattenGateMembers(item.members));
    else out.push(item);
  }
  return out;
}

/**
 * Resolve the nested `gate` bag for construction / boot.
 *
 * @param options - Gate bag + env (for auth secret rules)
 */
export function resolveGateConfig(options: ResolveGateConfigOptions = {}): ResolvedGateConfig {
  const bag = options.gate ?? {};
  let auth: ResolvedGateAuth | undefined;
  if (bag.auth !== undefined) {
    const { resolveGateAuth } = requirePackageModule<typeof import("../../auth/config.ts")>(
      "auth/config",
      "auth-config",
    );
    auth = resolveGateAuth({ auth: bag.auth, env: options.env });
  }
  const rateLimitEnabled =
    bag.rateLimit?.enabled !== undefined
      ? bag.rateLimit.enabled
      : auth !== undefined
        ? true
        : false;

  return {
    auth,
    policies: flattenGatePolicies(bag.policies ?? []),
    rateLimitEnabled,
    unguardedHttp: bag.unguardedHttp ?? "deny",
  };
}
