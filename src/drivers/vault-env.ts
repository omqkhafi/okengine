/**
 * `env` vault driver — resolves secrets from the process environment.
 *
 * Resolution order is owned by {@link createVaultRuntime}; this driver only
 * exposes one layer of the chain.
 */

import type {
  VaultBag,
  VaultDriver,
  VaultOpenOptions,
} from "./vault-types.ts";

/**
 * Create an env vault driver.
 *
 * Reads `options.env` when provided (tests); otherwise `process.env`.
 */
export const envVaultDriver: VaultDriver = {
  id: "env",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const env = options.env ?? process.env;
    const prefix = options.envPrefix ?? "";
    const map = new Map<string, string>();
    for (const [key, value] of Object.entries(env)) {
      if (typeof value !== "string" || value.length === 0) continue;
      if (prefix && !key.startsWith(prefix)) continue;
      const name = prefix ? key.slice(prefix.length) : key;
      if (name.length > 0) map.set(name, value);
    }
    return {
      driverId: "env",
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
    };
  },
};
