/**
 * Driver-agnostic SQL session used by `fx.store(sqlStore)`.
 *
 * Same flow code runs against sqlite, postgres, and memory — only the
 * bound {@link SqlConnection} changes.
 */

import { parseDurationMs } from "../clock/duration.ts";
import type { ClassificationMap, SqlConnection, SqlRow } from "../../drivers/types.ts";
import { maskRows, tableFromSql } from "./classify.ts";
import {
  mapRowToJs,
  prepareInsertRow,
  resolveColumns,
  resolveTableName,
  type TableHandle,
} from "./table.ts";

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
  /** Clock for {@link SqlStoreHandle.deleteExpired} (defaults to Date.now). */
  readonly now?: () => number;
}

/** Equality map for where clauses. */
export type WhereMap = Readonly<Record<string, unknown>>;

/**
 * Result of `.from(table)` — awaitable (all rows) or chain `.where(...)`.
 */
export interface SelectFromBuilder extends PromiseLike<SqlRow[]> {
  /**
   * Filter by column equality.
   *
   * @param where - Column equality predicates
   */
  where(where: WhereMap): Promise<SqlRow[]>;
}

/** Fluent select builder. */
export interface SelectBuilder {
  /**
   * Choose the source table.
   *
   * @param table - Table handle or Drizzle table
   */
  from(table: TableHandle | unknown): SelectFromBuilder;
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

/**
 * Continuations after `.values()`.
 * Awaitable — `await insert(t).values(row)` runs {@link InsertValuesBuilder.execute}.
 */
export interface InsertValuesBuilder extends PromiseLike<void> {
  /** Execute and return inserted rows (masked). */
  returning(): Promise<SqlRow[]>;
  /** Execute without returning rows. */
  execute(): Promise<void>;
}

/**
 * SQL handle returned by `fx.store(db)` for the sql facet.
 *
 * Includes helpers assumed by the four reference applications.
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
   * Find a row by primary key.
   *
   * @param table - Table
   * @param id - Primary key value
   */
  findById(table: TableHandle | unknown, id: string): Promise<SqlRow | null>;
  /**
   * Find a row by `code` column.
   *
   * @param table - Table
   * @param code - Code value
   */
  findByCode(table: TableHandle | unknown, code: string): Promise<SqlRow | null>;
  /**
   * Delete a row by primary key.
   *
   * @param table - Table
   * @param id - Primary key value
   */
  delete(table: TableHandle | unknown, id: string): Promise<boolean>;
  /**
   * True when at least one row matches.
   *
   * @param table - Table
   * @param idOrWhere - Primary key string, or column equality map
   */
  exists(
    table: TableHandle | unknown,
    idOrWhere: string | WhereMap,
  ): Promise<boolean>;
  /**
   * Atomically add `by` to `column` on the PK row.
   *
   * @param table - Table
   * @param id - Primary key value
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
   * Delete rows whose expiry column is older than `age` ago.
   *
   * Looks for `expiresAt` / `expires_at` / `createdAt` + age.
   *
   * @param table - Table
   * @param age - Duration string (e.g. `"30d"`)
   */
  deleteExpired(table: TableHandle | unknown, age: string): Promise<number>;
  /**
   * Read the `clicks` column for a row keyed by `code`.
   *
   * @param table - Table
   * @param code - Code value
   */
  getClicks(table: TableHandle | unknown, code: string): Promise<number>;
  /**
   * Upsert a daily click counter row.
   *
   * @param table - Daily stats table (`code`, `day`, `clicks`)
   * @param code - Link code
   * @param at - Epoch-ms timestamp
   */
  bumpDaily(
    table: TableHandle | unknown,
    code: string,
    at: number,
  ): Promise<void>;
  /**
   * List daily click rows for a code.
   *
   * @param table - Daily stats table
   * @param code - Link code
   */
  dailyFor(
    table: TableHandle | unknown,
    code: string,
  ): Promise<Array<{ day: string; clicks: number }>>;
  /**
   * Remaining stock for a SKU (reads `stock` / `products` / `inventory`).
   *
   * @param sku - Stock-keeping unit
   */
  stockOf(sku: string): Promise<number>;
  /**
   * Set a status column.
   *
   * Overloads:
   * - `setStatus(id, status)` — updates `orders` by id
   * - `setStatus(table, id, status)` — updates the given table
   *
   * @param tableOrId - Table handle, or order id when two-arg form
   * @param idOrStatus - Id, or status when two-arg form
   * @param status - Status when three-arg form
   */
  setStatus(
    tableOrId: TableHandle | unknown | string,
    idOrStatus: string,
    status?: string,
  ): Promise<void>;
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
  const now = options.now ?? (() => Date.now());

  function mask(rows: SqlRow[], table?: string): SqlRow[] {
    return maskRows(rows, { classifications, table, revealPii });
  }

  async function ensureFromMeta(table: TableHandle | unknown): Promise<void> {
    const cols = resolveColumns(table);
    if (cols.length === 0) return;
    const name = resolveTableName(table);
    const pk = cols.find((c) => c.primary)?.sqlName;
    const colSql = cols
      .map((c) => {
        const typ =
          pk && c.sqlName === pk
            ? `${c.sqlType} PRIMARY KEY`
            : c.sqlType;
        return `${quoteIdent(c.sqlName)} ${typ}`;
      })
      .join(", ");
    await connection.exec(
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(name)} (${colSql})`,
    );
  }

  function toJs(table: TableHandle | unknown, rows: SqlRow[]): SqlRow[] {
    return rows.map((r) => mapRowToJs(table, r) as SqlRow);
  }

  function normalizeWhere(
    table: TableHandle | unknown,
    where: WhereMap,
  ): WhereMap {
    const cols = resolveColumns(table);
    if (cols.length === 0) return where;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(where)) {
      const col = cols.find((c) => c.key === k || c.sqlName === k);
      out[col?.sqlName ?? k] = v;
    }
    return out;
  }

  async function selectWhere(
    table: TableHandle | unknown,
    where?: WhereMap,
  ): Promise<SqlRow[]> {
    await ensureFromMeta(table);
    const name = resolveTableName(table);
    if (!where || Object.keys(where).length === 0) {
      const rows = await connection.query(`SELECT * FROM ${quoteIdent(name)}`);
      return toJs(table, mask(rows, name));
    }
    const normalized = normalizeWhere(table, where);
    const entries = Object.entries(normalized);
    const clause = entries
      .map(([col]) => `${quoteIdent(col)} = ?`)
      .join(" AND ");
    const params = entries.map(([, v]) => v);
    const rows = await connection.query(
      `SELECT * FROM ${quoteIdent(name)} WHERE ${clause}`,
      params,
    );
    return toJs(table, mask(rows, name));
  }

  function selectFrom(table: TableHandle | unknown): SelectFromBuilder {
    const all = selectWhere(table);
    const builder = {
      where(where: WhereMap) {
        return selectWhere(table, where);
      },
      then<TResult1 = SqlRow[], TResult2 = never>(
        onfulfilled?:
          | ((value: SqlRow[]) => TResult1 | PromiseLike<TResult1>)
          | null,
        onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
      ) {
        return all.then(onfulfilled, onrejected);
      },
    };
    return builder;
  }

  return {
    ref,
    routedRole: options.routedRole,
    driverId: connection.driverId,

    select(): SelectBuilder {
      return {
        from(table) {
          return selectFrom(table);
        },
      };
    },

    insert(table): InsertBuilder {
      const name = resolveTableName(table);
      return {
        values(row) {
          const runExecute = async (): Promise<void> => {
            await ensureFromMeta(table);
            const prepared = prepareInsertRow(table, row);
            const cols = Object.keys(prepared);
            const placeholders = cols.map(() => "?").join(", ");
            const colList = cols.map(quoteIdent).join(", ");
            const params = cols.map((c) => prepared[c]);
            const sql = `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders})`;
            await connection.exec(sql, params);
          };
          return {
            async returning() {
              await ensureFromMeta(table);
              const prepared = prepareInsertRow(table, row);
              const cols = Object.keys(prepared);
              const placeholders = cols.map(() => "?").join(", ");
              const colList = cols.map(quoteIdent).join(", ");
              const params = cols.map((c) => prepared[c]);
              const sql = `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders}) RETURNING *`;
              const rows = await connection.query(sql, params);
              return toJs(table, mask(rows, name));
            },
            execute: runExecute,
            then(onfulfilled, onrejected) {
              return runExecute().then(onfulfilled, onrejected);
            },
          };
        },
      };
    },

    async findById(table, idValue) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const pk = resolvePkColumn(table);
      const rows = await connection.query(
        `SELECT * FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ?`,
        [idValue],
      );
      const masked = toJs(table, mask(rows, name));
      return masked[0] ?? null;
    },

    async findByCode(table, code) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const rows = await connection.query(
        `SELECT * FROM ${quoteIdent(name)} WHERE ${quoteIdent("code")} = ?`,
        [code],
      );
      const masked = toJs(table, mask(rows, name));
      return masked[0] ?? null;
    },

    async delete(table, idValue) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const pk = resolvePkColumn(table);
      const result = await connection.exec(
        `DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ?`,
        [idValue],
      );
      return result.changes > 0;
    },

    async exists(table, idOrWhere) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const where: WhereMap =
        typeof idOrWhere === "string"
          ? { [resolvePkColumn(table)]: idOrWhere }
          : normalizeWhere(table, idOrWhere);
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
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const pk = resolvePkColumn(table);
      const cols = resolveColumns(table);
      const colMeta = cols.find((c) => c.key === column || c.sqlName === column);
      const sqlCol = colMeta?.sqlName ?? column;
      const col = quoteIdent(sqlCol);
      const rows = await connection.query(
        `UPDATE ${quoteIdent(name)} SET ${col} = ${col} + ? WHERE ${quoteIdent(pk)} = ? RETURNING ${col}`,
        [by, idValue],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(
          `increment(): no row with ${pk} ${JSON.stringify(idValue)} in ${name}`,
        );
      }
      return asNumber(row[sqlCol], sqlCol);
    },

    async deleteExpired(table, age) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const ms = parseDurationMs(age);
      const cutoff = now() - ms;
      // Prefer expires_at / expiresAt; fall back to created_at / createdAt.
      for (const col of ["expires_at", "expiresAt", "created_at", "createdAt"]) {
        try {
          const result = await connection.exec(
            `DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent(col)} < ?`,
            [cutoff],
          );
          return result.changes;
        } catch {
          /* try next column */
        }
      }
      return 0;
    },

    async getClicks(table, code) {
      const row = await this.findByCode(table, code);
      if (!row) return 0;
      const clicks = row.clicks;
      if (typeof clicks === "number") return clicks;
      if (typeof clicks === "bigint") return Number(clicks);
      if (typeof clicks === "string") return Number(clicks) || 0;
      return 0;
    },

    async bumpDaily(table, code, at) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const day = new Date(at).toISOString().slice(0, 10);
      // Try update-first; insert when no row.
      const updated = await connection.exec(
        `UPDATE ${quoteIdent(name)} SET ${quoteIdent("clicks")} = ${quoteIdent("clicks")} + 1 WHERE ${quoteIdent("code")} = ? AND ${quoteIdent("day")} = ?`,
        [code, day],
      );
      if (updated.changes > 0) return;
      await connection.exec(
        `INSERT INTO ${quoteIdent(name)} (${quoteIdent("code")}, ${quoteIdent("day")}, ${quoteIdent("clicks")}) VALUES (?, ?, ?)`,
        [code, day, 1],
      );
    },

    async dailyFor(table, code) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const rows = await connection.query(
        `SELECT ${quoteIdent("day")}, ${quoteIdent("clicks")} FROM ${quoteIdent(name)} WHERE ${quoteIdent("code")} = ? ORDER BY ${quoteIdent("day")}`,
        [code],
      );
      return rows.map((r) => ({
        day: String(r.day ?? ""),
        clicks: asNumber(r.clicks, "clicks"),
      }));
    },

    async stockOf(sku) {
      for (const table of ["stock", "products", "inventory"]) {
        try {
          const rows = await connection.query(
            `SELECT * FROM ${quoteIdent(table)} WHERE ${quoteIdent("sku")} = ? LIMIT 1`,
            [sku],
          );
          const row = rows[0];
          if (!row) return 0;
          for (const key of ["qty", "stock", "left"]) {
            if (row[key] !== undefined && row[key] !== null) {
              return asNumber(row[key], key);
            }
          }
          return 0;
        } catch {
          /* try next table name */
        }
      }
      // Dev-friendly default when no stock table exists yet.
      return 999;
    },

    async setStatus(tableOrId, idOrStatus, status?) {
      if (status !== undefined) {
        const name = resolveTableName(tableOrId);
        const pk = resolvePkColumn(tableOrId);
        await connection.exec(
          `UPDATE ${quoteIdent(name)} SET ${quoteIdent("status")} = ? WHERE ${quoteIdent(pk)} = ?`,
          [status, idOrStatus],
        );
        return;
      }
      const id = String(tableOrId);
      const next = idOrStatus;
      await connection.exec(
        `UPDATE ${quoteIdent("orders")} SET ${quoteIdent("status")} = ? WHERE ${quoteIdent("id")} = ?`,
        [next, id],
      );
    },

    async raw(sql, params = []) {
      const table = tableFromSql(sql);
      const rows = await connection.query(sql, params);
      return mask(rows, table);
    },

    async ensureTable(table) {
      const cols = Object.values(table.columns);
      const pk = resolvePkColumn(table);
      const colSql = cols
        .map((c) => {
          const typ =
            c.name === pk
              ? "TEXT PRIMARY KEY"
              : c.name === "clicks" || c.name === "qty" || c.name === "createdAt" || c.name === "created_at"
                ? "INTEGER"
                : "TEXT";
          return `${quoteIdent(c.name)} ${typ}`;
        })
        .join(", ");
      await connection.exec(
        `CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (${colSql})`,
      );
    },
  };
}

/**
 * Resolve the primary-key column name for a table-like value.
 *
 * @param table - Table handle or Drizzle table
 */
export function resolvePkColumn(table: unknown): string {
  const cols = resolveColumns(table);
  const primary = cols.find((c) => c.primary);
  if (primary) return primary.sqlName;
  if (cols.some((c) => c.sqlName === "id" || c.key === "id")) return "id";
  if (cols.some((c) => c.sqlName === "code" || c.key === "code")) return "code";
  if (table && typeof table === "object") {
    const t = table as Record<string, unknown>;
    if ("id" in t) return "id";
    if ("code" in t) return "code";
  }
  return "id";
}

function asNumber(value: unknown, column: string): number {
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
    return Number(value);
  }
  throw new Error(`column ${JSON.stringify(column)} is not numeric`);
}

function quoteIdent(name: string): string {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) {
    throw new Error(`Invalid SQL identifier: ${name}`);
  }
  return `"${name}"`;
}
