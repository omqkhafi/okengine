/**
 * `env` vault driver — resolves secrets from the process environment
 * and/or a dotenv file path (`.env.local`, `.env.docker`, …).
 *
 * Resolution order is owned by {@link createVaultRuntime}; this driver only
 * exposes one layer of the chain. Layer identity (`process.env` vs file)
 * is declared on {@link VaultChainLayer.source}.
 */

import { parseDotenv, formatDotenv } from "./vault-dotenv-parse.ts";
import type {
  VaultBag,
  VaultDriver,
  VaultOpenOptions,
} from "./vault-types.ts";

/**
 * Create an env vault driver.
 *
 * Reads, in order of precedence for this single layer:
 * 1. `options.env` when provided (tests)
 * 2. dotenv file at `options.path` when provided
 * 3. otherwise `process.env`
 *
 * When both `env` and `path` are omitted, the bag is a snapshot of
 * `process.env` (immutable). When `path` is set, the bag is mutable and
 * persists via {@link VaultBag.set} / {@link VaultBag.delete}.
 */
export const envVaultDriver: VaultDriver = {
  id: "env",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const prefix = options.envPrefix ?? "";
    const map = new Map<string, string>();
    const mutable = options.path !== undefined && options.env === undefined;

    if (options.env) {
      fillFromRecord(map, options.env, prefix);
    } else if (options.path) {
      const file = Bun.file(options.path);
      if (await file.exists()) {
        const parsed = parseDotenv(await file.text());
        for (const [key, value] of parsed) {
          if (prefix && !key.startsWith(prefix)) continue;
          const name = prefix ? key.slice(prefix.length) : key;
          if (name.length > 0 && value.length > 0) map.set(name, value);
        }
      }
    } else {
      fillFromRecord(map, process.env, prefix);
    }

    const path = options.path;

    return {
      driverId: "env",
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
      ...(mutable
        ? {
            set(name: string, value: string) {
              map.set(name, value);
              if (path) {
                void Bun.write(path, formatDotenv(map));
              }
            },
            delete(name: string) {
              const had = map.delete(name);
              if (had && path) {
                void Bun.write(path, formatDotenv(map));
              }
              return had;
            },
          }
        : {}),
    };
  },
};

/**
 * Copy string entries from a record into a map, applying an optional prefix.
 *
 * @param map - Destination
 * @param record - Source env-like map
 * @param prefix - Optional key prefix to strip
 */
function fillFromRecord(
  map: Map<string, string>,
  record: Readonly<Record<string, string | undefined>>,
  prefix: string,
): void {
  for (const [key, value] of Object.entries(record)) {
    if (typeof value !== "string" || value.length === 0) continue;
    if (prefix && !key.startsWith(prefix)) continue;
    const name = prefix ? key.slice(prefix.length) : key;
    if (name.length > 0) map.set(name, value);
  }
}
