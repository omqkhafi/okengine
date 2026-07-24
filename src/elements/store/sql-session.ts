/**
 * Driver-agnostic SQL session used by `fx.store(sqlStore)`.
 *
 * Same flow code runs against sqlite, postgres, and memory — only the
 * bound {@link SqlConnection} changes.
 */

import type { ClassificationMap, SqlConnection, SqlRow } from "../../drivers/types.ts";
import { maskRows, tableFromSql } from "./classify.ts";
import { resolveTableName, type TableHandle } from "./table.ts";

/** Options for a SQL session. */
export interface SqlSessionOptions {
  /** Open connection (already role-routed). */
  readonly connection: SqlConnection;
  /** Schema classifications enforced at the boundary. */
  readonly classifications: ClassificationMap;
  /** Allow cleartext PII (requires `pii:reveal`). */
  readonly revealPii?: boolean;
  /** Which connection was chosen — exposed for replica proofs. */
  readonly routedRole: "primary" | "replica";
}

/** Fluent select builder. */
export interface SelectBuilder {
  /**
   * Choose the source table.
   *
   * @param table - Table handle or Drizzle table
   */
  from(table: TableHandle | unknown): Promise<SqlRow[]>;
}

/** Fluent insert builder. */
export interface InsertBuilder {
  /**
   * Provide row values.
   *
   * @param row - Row to insert
   */
  values(row: SqlRow): InsertValuesBuilder;
}

/** Continuations after `.values()`. */
export interface InsertValuesBuilder {
  /** Execute and return inserted rows (masked). */
  returning(): Promise<SqlRow[]>;
  /** Execute without returning rows. */
  execute(): Promise<void>;
}

/**
 * SQL handle returned by `fx.store(db)` for the sql facet.
 */
export interface SqlStoreHandle {
  /** Resource ref (`sql:name`). */
  readonly ref: `sql:${string}`;
  /** Connection role actually used for this invocation. */
  readonly routedRole: "primary" | "replica";
  /** Underlying driver id. */
  readonly driverId: SqlConnection["driverId"];
  /** Start a select. */
  select(): SelectBuilder;
  /**
   * Start an insert into `table`.
   *
   * @param table - Target table
   */
  insert(table: TableHandle | unknown): InsertBuilder;
  /**
   * Find a row by primary key `id`.
   *
   * @param table - Table
   * @param id - Primary key
   */
  findById(table: TableHandle | unknown, id: string): Promise<SqlRow | null>;
  /**
   * Delete a row by primary key `id`.
   *
   * @param table - Table
   * @param id - Primary key
   */
  delete(table: TableHandle | unknown, id: string): Promise<boolean>;
  /**
   * True when at least one row matches `where` (equality map).
   *
   * Issued as `SELECT 1 … LIMIT 1` — not a full row fetch.
   *
   * @param table - Table
   * @param where - Column equality predicates (at least one required)
   */
  exists(
    table: TableHandle | unknown,
    where: Readonly<Record<string, unknown>>,
  ): Promise<boolean>;
  /**
   * Atomically add `by` to `column` on the row with primary key `id`.
   *
   * Single `UPDATE … SET col = col + ? … RETURNING col` — never
   * read-modify-write. Returns the new column value.
   *
   * @param table - Table
   * @param id - Primary key
   * @param column - Numeric column to bump
   * @param by - Delta (default `1`)
   */
  increment(
    table: TableHandle | unknown,
    id: string,
    column: string,
    by?: number,
  ): Promise<number>;
  /**
   * Raw SQL — PII masking still applied at the boundary.
   *
   * @param sql - SQL with `?` placeholders
   * @param params - Bound parameters
   */
  raw(sql: string, params?: readonly unknown[]): Promise<SqlRow[]>;
  /**
   * Ensure a simple table exists (test / bootstrap helper).
   *
   * @param table - Table handle
   */
  ensureTable(table: TableHandle): Promise<void>;
}

/**
 * Create a SQL store handle over a connection.
 *
 * @param ref - Resource ref
 * @param options - Connection + classification
 */
export function createSqlStoreHandle(
  ref: `sql:${string}`,
  options: SqlSessionOptions,
): SqlStoreHandle {
  const { connection, classifications, revealPii } = options;

  function mask(rows: SqlRow[], table?: string): SqlRow[] {
    return maskRows(rows, { classifications, table, revealPii });
  }

  return {
    ref,
    routedRole: options.routedRole,
    driverId: connection.driverId,

    select(): SelectBuilder {
      return {
        async from(table) {
          const name = resolveTableName(table);
          const rows = await connection.query(`SELECT * FROM ${quoteIdent(name)}`);
          return mask(rows, name);
        },
      };
    },

    insert(table): InsertBuilder {
      const name = resolveTableName(table);
      return {
        values(row) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => "?").join(", ");
          const colList = cols.map(quoteIdent).join(", ");
          const params = cols.map((c) => row[c]);
          return {
            async returning() {
              // SQLite 3.35+ and Postgres both support RETURNING.
              const sql = `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders}) RETURNING *`;
              const rows = await connection.query(sql, params);
              return mask(rows, name);
            },
            async execute() {
              const sql = `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders})`;
              await connection.exec(sql, params);
            },
          };
        },
      };
    },

    async findById(table, idValue) {
      const name = resolveTableName(table);
      const rows = await connection.query(
        `SELECT * FROM ${quoteIdent(name)} WHERE ${quoteIdent("id")} = ?`,
        [idValue],
      );
      const masked = mask(rows, name);
      return masked[0] ?? null;
    },

    async delete(table, idValue) {
      const name = resolveTableName(table);
      const result = await connection.exec(
        `DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent("id")} = ?`,
        [idValue],
      );
      return result.changes > 0;
    },

    async exists(table, where) {
      const name = resolveTableName(table);
      const entries = Object.entries(where);
      if (entries.length === 0) {
        throw new Error("exists() requires at least one where predicate");
      }
      for (const [col] of entries) quoteIdent(col);
      const clause = entries
        .map(([col]) => `${quoteIdent(col)} = ?`)
        .join(" AND ");
      const params = entries.map(([, v]) => v);
      const rows = await connection.query(
        `SELECT 1 AS "ok" FROM ${quoteIdent(name)} WHERE ${clause} LIMIT 1`,
        params,
      );
      return rows.length > 0;
    },

    async increment(table, idValue, column, by = 1) {
      const name = resolveTableName(table);
      const col = quoteIdent(column);
      const rows = await connection.query(
        `UPDATE ${quoteIdent(name)} SET ${col} = ${col} + ? WHERE ${quoteIdent("id")} = ? RETURNING ${col}`,
        [by, idValue],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(
          `increment(): no row with id ${JSON.stringify(idValue)} in ${name}`,
        );
      }
      const next = row[column];
      if (typeof next === "number") return next;
      if (typeof next === "bigint") return Number(next);
      if (typeof next === "string" && next.trim() !== "" && !Number.isNaN(Number(next))) {
        return Number(next);
      }
      throw new Error(
        `increment(): column ${JSON.stringify(column)} is not numeric`,
      );
    },

    async raw(sql, params = []) {
      const table = tableFromSql(sql);
      const rows = await connection.query(sql, params);
      return mask(rows, table);
    },

    async ensureTable(table) {
      const cols = Object.values(table.columns);
      const colSql = cols
        .map((c) => {
          const typ = c.name === "id" ? "TEXT PRIMARY KEY" : "TEXT";
          return `${quoteIdent(c.name)} ${typ}`;
        })
        .join(", ");
      await connection.exec(
        `CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (${colSql})`,
      );
    },
  };
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}
