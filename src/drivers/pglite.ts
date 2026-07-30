/**
 * `pglite` driver — binds `@electric-sql/pglite` (optional peer, dynamic import).
 *
 * Protocol-named transport: PGlite is Postgres compiled to WASM — same wire
 * dialect as `postgres` (`?` params convert to `$n`), different transport.
 * drizzle-kit dialect: `postgresql`.
 *
 * Honest latency trade-off (measured on `@electric-sql/pglite@0.5.4`): first
 * init ~900 ms one-time (WASM instantiation); reopen of an existing datadir
 * ~44 ms; warm CRUD ~45 ms vs ~3 ms for `bun:sqlite` (~15× slower). Choose
 * `pglite` for dialect/pgvector parity on a laptop — never as a
 * latency-competitive default. `local` stays on `sqlite`.
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
  const dataDir = options.url && options.url.length > 0 ? options.url : ".oke/pgdata";
  const db = await PGlite.create(dataDir, { extensions: { vector } });
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
