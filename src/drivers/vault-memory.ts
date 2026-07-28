/**
 * In-memory vault driver — tests and deterministic harnesses.
 */

import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/**
 * Create a memory vault driver seeded from `options.secrets`.
 */
export const memoryVaultDriver: VaultDriver = {
  id: "memory",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const map = new Map<string, string>(
      Object.entries(options.secrets ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );
    return {
      driverId: "memory",
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
      set(name, value) {
        map.set(name, value);
      },
      delete(name) {
        return map.delete(name);
      },
    };
  },
};
