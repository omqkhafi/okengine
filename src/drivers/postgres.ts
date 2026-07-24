/**
 * `postgres` driver — binds `Bun.SQL` (never `pg` / postgres.js).
 *
 * Protocol-named: Neon, Supabase, RDS, Timescale all speak postgres.
 */

import type {
  SqlConnectOptions,
  SqlConnection,
  SqlDriver,
  SqlRow,
} from "./types.ts";

/** Minimal surface we use from Bun.SQL (and test fakes). */
export interface PostgresClientLike {
  unsafe(sql: string, values?: unknown[]): PromiseLike<SqlRow[] | { length: number; changes?: number } | SqlRow[]>;
  close?(options?: { timeout?: number }): Promise<void>;
}

/**
 * Convert `?` placeholders to Postgres `$1…$n`.
 *
 * @param sql - SQL with `?` placeholders
 */
export function toPostgresParams(sql: string): string {
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Open a Postgres connection via Bun.SQL.
 *
 * @param options - URL / role / injected client
 */
export async function connectPostgres(
  options: SqlConnectOptions = {},
): Promise<SqlConnection> {
  const role = options.role ?? "primary";
  const client =
    (options.client as PostgresClientLike | undefined) ??
    new Bun.SQL(options.url ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/oke");

  return {
    driverId: "postgres",
    role,
    async query(sql, params = []) {
      const pg = toPostgresParams(sql);
      const result = await client.unsafe(pg, [...params]);
      if (Array.isArray(result)) return result as SqlRow[];
      return Array.from(result as ArrayLike<SqlRow>);
    },
    async exec(sql, params = []) {
      const pg = toPostgresParams(sql);
      const result = await client.unsafe(pg, [...params]);
      if (
        result &&
        typeof result === "object" &&
        "changes" in result &&
        typeof (result as { changes: unknown }).changes === "number"
      ) {
        return { changes: (result as { changes: number }).changes };
      }
      if (Array.isArray(result)) {
        return { changes: result.length };
      }
      return { changes: 0 };
    },
    async close() {
      await client.close?.();
    },
  };
}

/**
 * In-memory Postgres-protocol fake for conformance when no server is available.
 * Speaks the same {@link SqlConnection} contract as the real driver.
 */
export function createPostgresFakeClient(): PostgresClientLike & {
  readonly tables: Map<string, SqlRow[]>;
} {
  const tables = new Map<string, SqlRow[]>();

  function parseIdent(raw: string): string {
    return raw.replaceAll('"', "").trim();
  }

  return {
    tables,
    async unsafe(sql, values = []) {
      const text = sql.trim();
      // Accept both ? (pre-conversion) and $n forms.
      const normalised = text.replace(/\$\d+/g, "?");

      const create =
        /^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\((.+)\)\s*$/i.exec(
          normalised,
        );
      if (create) {
        const name = parseIdent(create[1]!);
        if (!tables.has(name)) tables.set(name, []);
        return [];
      }

      const select =
        /^SELECT\s+\*\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*(?:WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?)?\s*$/i.exec(
          normalised,
        );
      if (select) {
        const rows = tables.get(parseIdent(select[1]!)) ?? [];
        if (select[2]) {
          const col = parseIdent(select[2]!);
          return rows.filter((r) => r[col] === values[0]).map((r) => ({ ...r }));
        }
        return rows.map((r) => ({ ...r }));
      }

      const insertReturning =
        /^INSERT\s+INTO\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*RETURNING\s+\*\s*$/i.exec(
          normalised,
        );
      if (insertReturning) {
        const name = parseIdent(insertReturning[1]!);
        const cols = insertReturning[2]!.split(",").map((c) => parseIdent(c));
        const row: SqlRow = {};
        cols.forEach((c, i) => {
          row[c] = values[i];
        });
        const list = tables.get(name) ?? [];
        list.push(row);
        tables.set(name, list);
        return [{ ...row }];
      }

      const insert =
        /^INSERT\s+INTO\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$/i.exec(
          normalised,
        );
      if (insert) {
        const name = parseIdent(insert[1]!);
        const cols = insert[2]!.split(",").map((c) => parseIdent(c));
        const row: SqlRow = {};
        cols.forEach((c, i) => {
          row[c] = values[i];
        });
        const list = tables.get(name) ?? [];
        list.push(row);
        tables.set(name, list);
        return [];
      }

      const del =
        /^DELETE\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?\s*$/i.exec(
          normalised,
        );
      if (del) {
        const name = parseIdent(del[1]!);
        const col = parseIdent(del[2]!);
        const list = tables.get(name) ?? [];
        const next = list.filter((r) => r[col] !== values[0]);
        const changes = list.length - next.length;
        tables.set(name, next);
        return Object.assign([], { changes });
      }

      throw new Error(`postgres fake: unsupported SQL: ${sql}`);
    },
    async close() {
      tables.clear();
    },
  };
}

/** Protocol-named postgres driver. */
export const postgresDriver: SqlDriver = {
  id: "postgres",
  facet: "sql",
  connect: connectPostgres,
};
