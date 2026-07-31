/**
 * `oke({ gate })` — nested Gate bag (auth · policies · rate · posture).
 */

import { resolveGateAuth, type GateAuthOptions, type ResolvedGateAuth } from "../../auth/config.ts";
import type { GateDecl } from "./declare.ts";

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
  /** Named policy / rate declarations for the Gate runtime. */
  readonly policies?: readonly GateDecl[];
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
 * Resolve the nested `gate` bag for construction / boot.
 *
 * @param options - Gate bag + env (for auth secret rules)
 */
export function resolveGateConfig(options: ResolveGateConfigOptions = {}): ResolvedGateConfig {
  const bag = options.gate ?? {};
  const auth =
    bag.auth !== undefined ? resolveGateAuth({ auth: bag.auth, env: options.env }) : undefined;
  const rateLimitEnabled =
    bag.rateLimit?.enabled !== undefined
      ? bag.rateLimit.enabled
      : auth !== undefined
        ? true
        : false;

  return {
    auth,
    policies: bag.policies ?? [],
    rateLimitEnabled,
    unguardedHttp: bag.unguardedHttp ?? "deny",
  };
}
