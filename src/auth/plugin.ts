/**
 * Builtin auth plugin — hybrid session, two planes, roles as data.
 *
 * Uses only the public plugin API (unified-theory §14).
 */

import { plugin, type PluginDef } from "../kernel/plugin.ts";
import { AUTH_TABLES } from "./tables.ts";

/** Options for {@link auth}. */
export interface AuthPluginOptions {
  /** HMAC secret for access tokens (required in production). */
  readonly secret?: string;
  /** Access-token TTL override (ms). */
  readonly accessTtlMs?: number;
  /** Refresh-token TTL override (ms). */
  readonly refreshTtlMs?: number;
}

/**
 * Builtin auth plugin.
 *
 * @param options - Session crypto options
 */
export function auth(options: AuthPluginOptions = {}): PluginDef {
  let builder = plugin("auth", { version: "0.0.1", config: options }).hook("onAuth", (_ctx) => {
    /* principals resolved by session / API key middleware at runtime */
  });

  for (const name of Object.values(AUTH_TABLES)) {
    builder = builder.table(name, undefined, {
      plane: name.includes("operator")
        ? "operator"
        : name.includes("identit") || name === AUTH_TABLES.credentials
          ? "user"
          : "shared",
    });
  }

  return builder.needs("store.sql");
}
