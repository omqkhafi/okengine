/**
 * Builtin auth plugin — hybrid session, two planes, roles as data.
 *
 * Uses only the public plugin API (unified-theory §14).
 */

import type { PasswordHashOptions } from "../runtime/types.ts";
import { plugin, type PluginDef } from "../kernel/plugin.ts";
import type { BreachCheckFn } from "./breach-check.ts";
import type { PasswordPolicyOptions } from "./password-policy.ts";
import { AUTH_TABLES } from "./tables.ts";
import { AUTH_TENANT_TABLES } from "./tenant-tables.ts";

/** Session knobs beyond raw access/refresh TTLs. */
export interface AuthSessionOptions {
  /** Access-token TTL override (ms). Default 14 minutes. */
  readonly accessTtlMs?: number;
  /** Refresh-token TTL override (ms). Default 30 days. */
  readonly refreshTtlMs?: number;
  /** Idle timeout from last activity (ms). Opt-in. */
  readonly idleTtlMs?: number;
  /** Absolute lifetime from session creation (ms). Opt-in. */
  readonly absoluteTtlMs?: number;
  /** Revoke other families for the same principal on issue. Opt-in. */
  readonly singleSessionPerUser?: boolean;
}

/** Options for {@link auth}. */
export interface AuthPluginOptions {
  /** HMAC secret for access tokens (required in production). */
  readonly secret?: string;
  /** Access-token TTL override (ms). Prefer {@link session}. */
  readonly accessTtlMs?: number;
  /** Refresh-token TTL override (ms). Prefer {@link session}. */
  readonly refreshTtlMs?: number;
  /** Session timeouts and single-session policy. */
  readonly session?: AuthSessionOptions;
  /**
   * Bun.password cost knobs. Defaults match Bun argon2id (`m=65536`, `t=2`);
   * weaker values are rejected.
   */
  readonly password?: PasswordHashOptions;
  /**
   * Password length / character-class policy (defaults: minLength 8,
   * letter, number, upper, lower, symbol). Credential-set paths enforce defaults unless a
   * caller passes `skipPasswordPolicy` (tests only).
   */
  readonly passwordPolicy?: PasswordPolicyOptions;
  /**
   * Pluggable breach check (`true` = reject). Default off.
   * Use {@link createHibpBreachCheck} for Have I Been Pwned k-anonymity.
   */
  readonly breachCheck?: BreachCheckFn;
}

/**
 * Flatten plugin options into {@link SessionCrypto}-compatible fields.
 *
 * @param options - Auth plugin options
 */
export function sessionCryptoFromAuthOptions(options: AuthPluginOptions): {
  readonly accessTtlMs?: number;
  readonly refreshTtlMs?: number;
  readonly idleTtlMs?: number;
  readonly absoluteTtlMs?: number;
  readonly singleSessionPerUser?: boolean;
} {
  return {
    accessTtlMs: options.session?.accessTtlMs ?? options.accessTtlMs,
    refreshTtlMs: options.session?.refreshTtlMs ?? options.refreshTtlMs,
    idleTtlMs: options.session?.idleTtlMs,
    absoluteTtlMs: options.session?.absoluteTtlMs,
    singleSessionPerUser: options.session?.singleSessionPerUser,
  };
}

/**
 * Builtin auth plugin.
 *
 * @param options - Session crypto / password policy options
 */
export function auth(options: AuthPluginOptions = {}): PluginDef {
  let builder = plugin("auth", { version: "0.0.1", config: options }).hook("onAuth", (_ctx) => {
    /* principals resolved by session / API key middleware at runtime */
  });

  const tables: readonly string[] = [
    ...Object.values(AUTH_TABLES),
    ...Object.values(AUTH_TENANT_TABLES),
  ];
  for (const name of tables) {
    builder = builder.table(name, undefined, {
      plane: name.includes("operator")
        ? "operator"
        : name.includes("identit") ||
            name === AUTH_TABLES.credentials ||
            name === AUTH_TABLES.verifications
          ? "user"
          : "shared",
    });
  }

  return builder.needs("store.sql");
}
