/**
 * `pglite` driver — binds `@electric-sql/pglite` (optional peer, dynamic import).
 *
 * Protocol-named transport: PGlite is Postgres compiled to WASM — same wire
 * dialect as `postgres` (`?` params convert to `$n`), different transport.
 * drizzle-kit dialect: `postgresql`.
 *
 * Honest latency trade-off (measured on `@electric-sql/pglite@0.5.4`): first
 * init ~900 ms one-time (WASM instantiation); reopen of an existing datadir
 * ~44 ms; warm CRUD ~45 ms. Default for `env: "test"` (`memory://`);
 * `dev`/`prod` use real Postgres via Docker.
 */

import { toPostgresParams } from "./postgres.ts";
import type { SqlConnectOptions, SqlConnection, SqlDriver, SqlRow } from "./types.ts";

/** `@electric-sql/pglite` is an optional peer — loaded only when this driver runs. */
type PgliteModule = typeof import("@electric-sql/pglite");
type PgliteVectorModule = typeof import("@electric-sql/pglite-pgvector");

async function loadPglite(): Promise<PgliteModule> {
  try {
    return await import("@electric-sql/pglite");
  } catch {
    throw new Error(
      "pglite driver: install optional peer `@electric-sql/pglite` (bun add @electric-sql/pglite)",
    );
  }
}

async function loadPgliteVector(): Promise<PgliteVectorModule> {
  try {
    return await import("@electric-sql/pglite-pgvector");
  } catch {
    throw new Error(
      "pglite driver: install optional peer `@electric-sql/pglite-pgvector` (bun add @electric-sql/pglite-pgvector)",
    );
  }
}

/** Default on-disk PGlite datadir (under the project `.oke/` tree). */
export const PGLITE_DEFAULT_DATADIR = ".oke/pgdata";

/**
 * Resolve a PGlite URL to either in-memory (`memory://…`) or an on-disk datadir.
 *
 * SQLite's `":memory:"` is **not** in-memory for PGlite — it would create a
 * literal `./:memory:` folder. Map that legacy token to {@link PGLITE_DEFAULT_DATADIR}.
 *
 * @param url - Raw connect URL / path
 */
export function resolvePgliteDataDir(url: string | undefined): string | "memory" {
  const raw = url && url.length > 0 ? url : PGLITE_DEFAULT_DATADIR;
  if (raw.startsWith("memory://")) return "memory";
  if (raw === ":memory:") return PGLITE_DEFAULT_DATADIR;
  return raw;
}

/**
 * Open a PGlite connection implementing {@link SqlConnection}.
 *
 * The pgvector extension is loaded at `PGlite.create` so `CREATE EXTENSION
 * vector` in the pgvector index driver succeeds — same real-ANN code path as
 * `postgres`.
 *
 * @param options - URL (`memory://` or a datadir path; default `.oke/pgdata`) / role
 */
export async function connectPglite(options: SqlConnectOptions = {}): Promise<SqlConnection> {
  const role = options.role ?? "primary";
  const { PGlite } = await loadPglite();
  const { vector } = await loadPgliteVector();
  const resolved = resolvePgliteDataDir(options.url);
  // `memory://…` must be a fresh in-memory instance every connect — passing the
  // string as dataDir is not reliably isolated across boots (IF NOT EXISTS then
  // keeps a prior INTEGER column after we switch DDL to BIGINT).
  const db =
    resolved === "memory"
      ? await PGlite.create({ extensions: { vector } })
      : await PGlite.create(resolved, { extensions: { vector } });
  return {
    driverId: "pglite",
    role,
    async query(sql, params = []) {
      const rs = await db.query<SqlRow>(toPostgresParams(sql), [...params]);
      return rs.rows;
    },
    async exec(sql, params = []) {
      const rs = await db.query<SqlRow>(toPostgresParams(sql), [...params]);
      return { changes: rs.affectedRows ?? 0 };
    },
    async close() {
      await db.close();
    },
  };
}

/** Protocol-named pglite driver. */
export const pgliteDriver: SqlDriver = {
  id: "pglite",
  facet: "sql",
  connect: connectPglite,
};
