/**
 * `sqlite` driver — binds `bun:sqlite` (never better-sqlite3).
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import type { SqlConnectOptions, SqlConnection, SqlDriver, SqlRow } from "./types.ts";

/**
 * Open a bun:sqlite connection implementing {@link SqlConnection}.
 *
 * @param options - URL (`:memory:` / path) or injected Database
 */
export async function connectSqlite(options: SqlConnectOptions = {}): Promise<SqlConnection> {
  const role = options.role ?? "primary";
  const db =
    options.client instanceof Database ? options.client : new Database(options.url ?? ":memory:");

  function asBindings(params: readonly unknown[]): SQLQueryBindings[] {
    return params as SQLQueryBindings[];
  }

  return {
    driverId: "sqlite",
    role,
    async query(sql, params = []) {
      const stmt = db.query(sql);
      return stmt.all(...(asBindings(params) as never[])) as SqlRow[];
    },
    async exec(sql, params = []) {
      const result = db.run(sql, ...(asBindings(params) as never[]));
      return { changes: result.changes };
    },
    async close() {
      db.close();
    },
  };
}

/** Protocol-named sqlite driver. */
export const sqliteDriver: SqlDriver = {
  id: "sqlite",
  facet: "sql",
  connect: connectSqlite,
};
