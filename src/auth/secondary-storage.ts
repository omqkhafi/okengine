/**
 * Optional secondary storage for hot auth data (Phase 1a) — `store.kv`.
 */

import type { ResolvedGateAuth } from "./config.ts";

/** Minimal kv surface used by auth secondary storage. */
export interface AuthKv {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown, opts?: { readonly ttlMs?: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/**
 * Create a namespaced kv helper for session / challenge hot paths.
 *
 * @param kv - Kv handle
 * @param config - Resolved auth
 */
export function createAuthSecondaryStorage(
  kv: AuthKv,
  config: ResolvedGateAuth,
): AuthKv | undefined {
  if (!config.secondaryStorage.enabled) return undefined;
  const prefix = config.secondaryStorage.prefix;
  return {
    async get(key) {
      return kv.get(`${prefix}${key}`);
    },
    async set(key, value, opts) {
      await kv.set(`${prefix}${key}`, value, opts);
    },
    async delete(key) {
      await kv.delete(`${prefix}${key}`);
    },
  };
}
