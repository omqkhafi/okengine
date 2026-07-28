/**
 * `managed` vault driver — platform-injected secrets (Fly / Railway / K8s).
 *
 * Values arrive as an injected map (or env); OKE never invents a vendor client.
 */

import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/**
 * Managed / platform vault driver.
 */
export const managedVaultDriver: VaultDriver = {
  id: "managed",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const fromSecrets = Object.entries(options.secrets ?? {}).filter(
      (e): e is [string, string] => typeof e[1] === "string",
    );
    const fromEnv = Object.entries(options.env ?? process.env).filter(
      (e): e is [string, string] => typeof e[1] === "string" && e[1].length > 0,
    );
    const map = new Map<string, string>([...fromEnv, ...fromSecrets]);
    return {
      driverId: "managed",
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
