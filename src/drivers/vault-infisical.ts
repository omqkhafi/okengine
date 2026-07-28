/**
 * `infisical` vault driver — Infisical REST secrets API (protocol-shaped).
 */

import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/**
 * Infisical secrets driver.
 *
 * `url` + `token` (+ optional `mount` as project/env path) load secrets at open.
 */
export const infisicalVaultDriver: VaultDriver = {
  id: "infisical",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const url = options.url?.replace(/\/$/, "");
    const token = options.token;
    const fetchFn = options.fetch ?? globalThis.fetch;
    const map = new Map<string, string>(
      Object.entries(options.secrets ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );

    if (url && token) {
      try {
        const path = options.mount
          ? `${url}/api/v3/secrets/raw?secretPath=${encodeURIComponent(options.mount)}`
          : `${url}/api/v3/secrets/raw`;
        const res = await fetchFn(path, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const body = (await res.json()) as {
            secrets?: Array<{ secretKey?: string; secretValue?: string }>;
          };
          for (const s of body.secrets ?? []) {
            if (s.secretKey && typeof s.secretValue === "string") {
              map.set(s.secretKey, s.secretValue);
            }
          }
        }
      } catch {
        // Remote unavailable — boot validation reports gaps.
      }
    }

    return {
      driverId: "infisical",
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
    };
  },
};
