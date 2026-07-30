/**
 * `openbao` vault driver — OpenBao (Vault-compatible) KV v2 HTTP API.
 *
 * Protocol-named; image/vendor choice lives in `images`.
 */

import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/** Error thrown when the remote OpenBao is unreachable / sealed / errors. */
export class OpenBaoUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OpenBaoUnavailableError";
  }
}

/**
 * OpenBao KV-v2 bag. Reads are loaded at open when `url` + `token` resolve;
 * writes (`set` / `delete`) hit the HTTP API directly.
 *
 * When `url` and `token` are provided, an unreachable, sealed, or erroring
 * OpenBao is **fatal** (fail-loud) — the bag never silently degrades to an
 * empty / seed-only view.
 *
 * For boot validation the runtime passes declared names; this driver loads
 * all keys under `mount` when the LIST API is available, else falls back to
 * GETs for the seed names.
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

    const remote = url !== undefined && token !== undefined;
    let mutableRemote = false;

    if (remote && url !== undefined && token !== undefined) {
      const headers = { "X-Vault-Token": token };
      const base = `${url}/v1/${mount}`;

      async function listNames(): Promise<string[]> {
        const res = await fetchFn(`${base}/metadata?list=true`, { headers });
        if (!res.ok) return [];
        const body = (await res.json()) as { data?: { keys?: string[] } };
        return (body.data?.keys ?? []).map((k) => k.replace(/\/$/, ""));
      }

      async function readName(name: string): Promise<boolean> {
        const res = await fetchFn(`${base}/data/${encodeURIComponent(name)}`, { headers });
        if (res.status === 404) return false;
        if (!res.ok) {
          throw new OpenBaoUnavailableError(
            `openbao vault: GET ${name} failed (${res.status}) — sealed or unauthorized?`,
          );
        }
        const body = (await res.json()) as { data?: { data?: Record<string, unknown> } };
        const data = body.data?.data ?? {};
        const value =
          typeof data.value === "string"
            ? data.value
            : typeof data[name] === "string"
              ? (data[name] as string)
              : JSON.stringify(data);
        map.set(name, value);
        return true;
      }

      // LIST when the token has metadata list; otherwise only fetch the
      // seed/declared names so a least-privilege token still works. A
      // connection-level failure here must never degrade to an empty bag.
      let names: string[] = [];
      try {
        names = await listNames();
      } catch (err) {
        if (map.size === 0) {
          throw new OpenBaoUnavailableError(
            `openbao vault: unreachable at ${url} — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        // Fall through: LIST denied but we still have declared names to GET.
      }
      if (names.length > 0) {
        for (const key of names) await readName(key);
        mutableRemote = true;
      } else if (map.size > 0) {
        for (const name of map.keys()) await readName(name);
        mutableRemote = true;
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
      ...(mutableRemote && url !== undefined && token !== undefined
        ? {
            set(name: string, value: string) {
              void (async () => {
                const res = await fetchFn(`${url}/v1/${mount}/data/${encodeURIComponent(name)}`, {
                  method: "POST",
                  headers: { "X-Vault-Token": token, "content-type": "application/json" },
                  body: JSON.stringify({ data: { value } }),
                });
                if (!res.ok) {
                  throw new OpenBaoUnavailableError(
                    `openbao vault: write ${name} failed (${res.status})`,
                  );
                }
                map.set(name, value);
              })();
            },
            delete(name: string) {
              const had = map.delete(name);
              void (async () => {
                const res = await fetchFn(`${url}/v1/${mount}/data/${encodeURIComponent(name)}`, {
                  method: "DELETE",
                  headers: { "X-Vault-Token": token },
                });
                if (!res.ok && res.status !== 404) {
                  throw new OpenBaoUnavailableError(
                    `openbao vault: delete ${name} failed (${res.status})`,
                  );
                }
              })();
              return had;
            },
          }
        : {}),
    };
  },
};
