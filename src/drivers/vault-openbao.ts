/**
 * `openbao` vault driver — HashiCorp Vault / OpenBao KV v2 HTTP API.
 *
 * Protocol-named; image/vendor choice lives in `images`.
 */

import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/**
 * OpenBao / Vault KV driver.
 *
 * Expects `url` + `token` + optional `mount` (default `secret`).
 * Fetches `GET {url}/v1/{mount}/data/{name}` for each requested secret
 * lazily via a cached bag loaded at open when `secrets` seed keys are listed,
 * or returns empty until {@link VaultBag.get} is called against a remote.
 *
 * For boot validation the runtime passes declared names; this driver loads
 * all keys under `mount` when the LIST API is available, else uses seed names.
 */
export const openbaoVaultDriver: VaultDriver = {
  id: "openbao",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const url = options.url?.replace(/\/$/, "");
    const token = options.token;
    const mount = options.mount ?? "secret";
    const fetchFn = options.fetch ?? globalThis.fetch;
    const map = new Map<string, string>(
      Object.entries(options.secrets ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );

    if (url && token) {
      // Best-effort LIST; ignore failures (permission / disabled).
      try {
        const listRes = await fetchFn(`${url}/v1/${mount}/metadata?list=true`, {
          headers: { "X-Vault-Token": token },
        });
        if (listRes.ok) {
          const body = (await listRes.json()) as {
            data?: { keys?: string[] };
          };
          for (const key of body.data?.keys ?? []) {
            const getRes = await fetchFn(`${url}/v1/${mount}/data/${key}`, {
              headers: { "X-Vault-Token": token },
            });
            if (!getRes.ok) continue;
            const got = (await getRes.json()) as {
              data?: { data?: Record<string, unknown> };
            };
            const data = got.data?.data ?? {};
            const value =
              typeof data.value === "string"
                ? data.value
                : typeof data[key] === "string"
                  ? (data[key] as string)
                  : JSON.stringify(data);
            map.set(key.replace(/\/$/, ""), value);
          }
        }
      } catch {
        // Remote unavailable — bag stays at seed / empty; boot validation reports gaps.
      }
    }

    return {
      driverId: "openbao",
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
    };
  },
};
