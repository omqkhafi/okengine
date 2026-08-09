/**
 * `vault` driver — okengine's own encrypted-at-rest secret store.
 *
 * The built-in Vault is asynchronous and path-addressed
 * ({@link BuiltinVaultAdapter}), while the boot resolution chain wants a
 * synchronous name→value {@link VaultBag}. This driver bridges the two: at
 * `open` it unseals with `OKE_VAULT_MASTER_KEY`, snapshots every live secret
 * into a bag, and keeps the adapter around for write-through.
 *
 * Boot must never die because the operator has not run `oke vault init` yet,
 * so an uninitialized, sealed, or unreachable backend degrades to the seed
 * bag — the Vault runtime then reports the missing contracts as ordinary
 * gaps, with the same message every other driver produces.
 */

import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
  type BuiltinVaultAdapter,
} from "../elements/vault/builtin-adapter.ts";
import type { SqlConnection } from "./types.ts";
import type { VaultBag, VaultDriver, VaultOpenOptions } from "./vault-types.ts";

/** Environment variable holding the base64 master key. */
export const VAULT_MASTER_KEY_ENV = "OKE_VAULT_MASTER_KEY";

/** Test-only handle to the adapter a bag is sealing on {@link VaultBag.close}. */
export const VAULT_BAG_ADAPTER = Symbol.for("oke.vault.bagAdapter");

/** Options for {@link openBuiltinVaultAdapter}. */
export interface OpenBuiltinVaultOptions {
  /** Postgres URL. Falls back to `DATABASE_URL` / `OKE_STORE_SQL_URL`, then PGlite. */
  readonly url?: string;
  /** Pre-opened SQL connection — wins over `url`. */
  readonly connection?: SqlConnection;
  /** Base64 master key to unseal with. Defaults to `OKE_VAULT_MASTER_KEY`. */
  readonly masterKey?: string;
  /** Injected env map for tests. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** DEKs re-wrapped per master-rotation batch. */
  readonly kekRewrapBatchSize?: number;
}

/** An adapter plus the connection this module opened for it, if any. */
export interface OpenedBuiltinVault {
  /** The built-in adapter, unsealed when a valid master key was available. */
  readonly adapter: BuiltinVaultAdapter;
  /** Close the underlying connection when this module opened it. */
  close(): Promise<void>;
}

/**
 * Open the built-in Vault adapter over SQL, unsealing when a master key is
 * available.
 *
 * Used by the CLI (`oke vault …`) and Console, which need the full
 * path-addressed surface rather than a flat bag.
 *
 * @param options - URL / connection / master key / batch size
 */
export async function openBuiltinVaultAdapter(
  options: OpenBuiltinVaultOptions = {},
): Promise<OpenedBuiltinVault> {
  const env = options.env ?? process.env;
  const url = options.url ?? env.DATABASE_URL ?? env.OKE_STORE_SQL_URL;

  let owned: SqlConnection | undefined;
  let connection = options.connection;
  if (!connection) {
    owned = await connectVaultSql(url);
    connection = owned;
  }

  const adapter = createBuiltinVaultAdapter({
    db: sqlConnectionAsExec(connection),
    ...(options.kekRewrapBatchSize === undefined
      ? {}
      : { kekRewrapBatchSize: options.kekRewrapBatchSize }),
  });

  const masterKey = options.masterKey ?? env[VAULT_MASTER_KEY_ENV];
  if (masterKey !== undefined && masterKey.trim().length > 0) {
    await adapter.unseal(masterKey);
  }

  return {
    adapter,
    async close() {
      await owned?.close();
    },
  };
}

/**
 * Built-in Vault driver. Reads resolve from a snapshot taken at `open`.
 */
export const builtinVaultDriver: VaultDriver = {
  id: "vault",
  async open(options: VaultOpenOptions = {}): Promise<VaultBag> {
    const map = new Map<string, string>(
      Object.entries(options.secrets ?? {}).filter(
        (e): e is [string, string] => typeof e[1] === "string",
      ),
    );

    const env = options.env ?? process.env;
    const url = options.url ?? env.DATABASE_URL ?? env.OKE_STORE_SQL_URL;

    let opened: OpenedBuiltinVault | undefined;
    // With no SQL configured there is nothing to snapshot, and spinning up a
    // throwaway PGlite instance would cost every boot ~1s for an empty bag.
    if (options.connection !== undefined || url !== undefined) {
      try {
        opened = await openBuiltinVaultAdapter({
          env,
          ...(options.connection !== undefined ? { connection: options.connection } : { url }),
        });
        if (opened.adapter.getUnsealer() !== null) {
          for (const entry of await opened.adapter.list()) {
            const secret = await opened.adapter.get(entry.path);
            if (secret) map.set(entry.path, secret.value);
          }
        }
      } catch {
        // Uninitialized / sealed / unreachable: fall back to the seed bag so
        // boot reports missing contracts instead of a driver stack trace.
        await opened?.close().catch(() => undefined);
        opened = undefined;
      }
    }

    const adapter = opened?.adapter;
    return {
      driverId: "vault",
      ...(adapter === undefined ? {} : { [VAULT_BAG_ADAPTER]: adapter }),
      get(name) {
        return map.get(name);
      },
      names() {
        return [...map.keys()];
      },
      set(name, value) {
        map.set(name, value);
        if (adapter && adapter.getUnsealer() !== null) {
          void adapter.set(name, value).catch(() => undefined);
        }
      },
      delete(name) {
        const had = map.delete(name);
        if (adapter && adapter.getUnsealer() !== null) {
          void adapter.delete(name).catch(() => undefined);
        }
        return had;
      },
      async close() {
        // Auto-seal on bag close (app stop / SIGTERM → bootResult.close → vault.close).
        // Clears the in-memory master key before the SQL connection drops.
        try {
          await adapter?.seal();
        } catch {
          // Already sealed / never unsealed — ignore.
        }
        await opened?.close();
      },
    } as VaultBag;
  },
};

/**
 * Open the SQL connection backing the built-in Vault.
 *
 * A real Postgres URL uses the `postgres` driver; anything else (including
 * no URL at all) uses PGlite so local dev and tests work with no services.
 *
 * @param url - Resolved SQL URL, when configured
 */
async function connectVaultSql(url: string | undefined): Promise<SqlConnection> {
  if (url !== undefined && /^postgres(ql)?:\/\//.test(url)) {
    const { connectPostgres } = await import("./postgres.ts");
    return connectPostgres({ url });
  }
  const { connectPglite } = await import("./pglite.ts");
  return connectPglite(url === undefined ? {} : { url });
}
