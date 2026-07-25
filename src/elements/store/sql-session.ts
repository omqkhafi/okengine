/**
 * Driver-agnostic SQL session used by `fx.store(sqlStore)`.
 *
 * Thin, protocol-agnostic subset — never domain-named helpers.
 * Same flow code runs against sqlite, postgres, and memory.
 */

import type { ClassificationMap, SqlConnection, SqlRow } from "../../drivers/types.ts";
import { maskRows, tableFromSql } from "./classify.ts";
import {
  compileWhere,
  resolveSelectColumns,
  type WhereMap,
} from "./sql-condition.ts";
import {
  mapRowToJs,
  prepareInsertRow,
  resolveColumns,
  resolveTableName,
  type TableHandle,
} from "./table.ts";

export type { WhereMap } from "./sql-condition.ts";

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

/**
 * Continuations after `.where(...)` on a select — awaitable, optional `.limit`.
 */
export interface SelectWhereBuilder extends PromiseLike<SqlRow[]> {
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<SqlRow[]>;
}

/**
 * Result of `.from(table)` — awaitable (all rows) or chain `.where(...)`.
 */
export interface SelectFromBuilder extends PromiseLike<SqlRow[]> {
  /**
   * Filter with a plain equality map or a Drizzle SQL condition
   * (`eq`, `and`, `lt`, …).
   *
   * @param where - Condition
   */
  where(where: unknown): SelectWhereBuilder;
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

/** Fluent delete after `delete(table)` (no id). */
export interface DeleteBuilder {
  /**
   * Delete rows matching a condition.
   *
   * @param where - Equality map or Drizzle SQL
   */
  where(where: unknown): Promise<number>;
}

/** Fluent update builder. */
export interface UpdateBuilder {
  /**
   * Columns to set.
   *
   * @param row - Partial row (JS keys)
   */
  set(row: SqlRow): UpdateSetBuilder;
}

/** Continuations after `.set(...)`. */
export interface UpdateSetBuilder {
  /**
   * Restrict the update.
   *
   * @param where - Equality map or Drizzle SQL
   */
  where(where: unknown): Promise<number>;
}

/**
 * SQL handle returned by `fx.store(db)` for the sql facet.
 *
 * Generic v1 subset + Prompt 9.1 helpers. No business-named methods.
 */
export interface SqlStoreHandle {
  /** Resource ref (`sql:name`). */
  readonly ref: `sql:${string}`;
  /** Connection role actually used for this invocation. */
  readonly routedRole: "primary" | "replica";
  /** Underlying driver id. */
  readonly driverId: SqlConnection["driverId"];
  /**
   * Start a select. Optional column map projects / aliases columns
   * (`select({ clicks: links.clicks })`).
   *
   * @param columns - Optional `{ alias: drizzleColumn }` map
   */
  select(columns?: unknown): SelectBuilder;
  /**
   * Start an insert into `table`.
   *
   * @param table - Target table
   */
  insert(table: TableHandle | unknown): InsertBuilder;
  /**
   * Start an update on `table`.
   *
   * @param table - Target table
   */
  update(table: TableHandle | unknown): UpdateBuilder;
  /**
   * Find a row by primary key.
   *
   * @param table - Table
   * @param id - Primary key value
   */
  findById(table: TableHandle | unknown, id: string): Promise<SqlRow | null>;
  /**
   * Delete by primary key, or start a fluent `.where(...)` delete.
   *
   * @param table - Table
   * @param id - Primary key when using the two-arg form
   */
  delete(table: TableHandle | unknown): DeleteBuilder;
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

  function normalizeWhereMap(
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

  function compileTableWhere(
    table: TableHandle | unknown,
    where: unknown,
  ): ReturnType<typeof compileWhere> {
    if (
      where &&
      typeof where === "object" &&
      !Array.isArray(where) &&
      !("queryChunks" in (where as object))
    ) {
      return compileWhere(normalizeWhereMap(table, where as WhereMap));
    }
    return compileWhere(where);
  }

  async function runSelect(
    table: TableHandle | unknown,
    projection: ReturnType<typeof resolveSelectColumns>,
    where: unknown | undefined,
    limit?: number,
  ): Promise<SqlRow[]> {
    await ensureFromMeta(table);
    const name = resolveTableName(table);
    const selectList =
      projection === null
        ? "*"
        : projection
            .map((c) =>
              c.alias === c.sqlName
                ? quoteIdent(c.sqlName)
                : `${quoteIdent(c.sqlName)} AS ${quoteIdent(c.alias)}`,
            )
            .join(", ");

    let sql = `SELECT ${selectList} FROM ${quoteIdent(name)}`;
    const params: unknown[] = [];
    if (where !== undefined) {
      const compiled = compileTableWhere(table, where);
      if (compiled.clause) {
        sql += ` WHERE ${compiled.clause}`;
        params.push(...compiled.params);
      }
    }
    if (limit !== undefined) {
      sql += ` LIMIT ${Math.max(0, Math.floor(limit))}`;
    }

    const rows = await connection.query(sql, params);
    if (projection === null) {
      return toJs(table, mask(rows, name));
    }
    // Projected aliases are already the returned keys.
    return mask(
      rows.map((r) => {
        const out: SqlRow = {};
        for (const c of projection) {
          out[c.alias] = r[c.alias] ?? r[c.sqlName];
        }
        return out;
      }),
      name,
    );
  }

  function selectFrom(
    table: TableHandle | unknown,
    columns?: unknown,
  ): SelectFromBuilder {
    const projection = resolveSelectColumns(columns);
    const all = runSelect(table, projection, undefined);
    return {
      where(where) {
        const filtered = runSelect(table, projection, where);
        return {
          limit(n) {
            return runSelect(table, projection, where, n);
          },
          then(onfulfilled, onrejected) {
            return filtered.then(onfulfilled, onrejected);
          },
        };
      },
      then(onfulfilled, onrejected) {
        return all.then(onfulfilled, onrejected);
      },
    };
  }

  const handle: SqlStoreHandle = {
    ref,
    routedRole: options.routedRole,
    driverId: connection.driverId,

    select(columns?) {
      return {
        from(table) {
          return selectFrom(table, columns);
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

    update(table): UpdateBuilder {
      const name = resolveTableName(table);
      return {
        set(row) {
          return {
            async where(where) {
              await ensureFromMeta(table);
              const prepared = prepareInsertRow(table, row);
              const setEntries = Object.entries(prepared);
              if (setEntries.length === 0) return 0;
              const setSql = setEntries
                .map(([col]) => `${quoteIdent(col)} = ?`)
                .join(", ");
              const compiled = compileTableWhere(table, where);
              if (!compiled.clause) {
                throw new Error("update().set().where(): condition required");
              }
              const params = [
                ...setEntries.map(([, v]) => v),
                ...compiled.params,
              ];
              const result = await connection.exec(
                `UPDATE ${quoteIdent(name)} SET ${setSql} WHERE ${compiled.clause}`,
                params,
              );
              return result.changes;
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

    delete: ((
      table: TableHandle | unknown,
      idValue?: string,
    ): DeleteBuilder | Promise<boolean> => {
      if (idValue !== undefined) {
        return (async () => {
          await ensureFromMeta(table);
          const name = resolveTableName(table);
          const pk = resolvePkColumn(table);
          const result = await connection.exec(
            `DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ?`,
            [idValue],
          );
          return result.changes > 0;
        })();
      }
      const builder: DeleteBuilder = {
        async where(where) {
          await ensureFromMeta(table);
          const name = resolveTableName(table);
          const compiled = compileTableWhere(table, where);
          if (!compiled.clause) {
            throw new Error("delete().where(): condition required");
          }
          const result = await connection.exec(
            `DELETE FROM ${quoteIdent(name)} WHERE ${compiled.clause}`,
            compiled.params,
          );
          return result.changes;
        },
      };
      return builder;
    }) as SqlStoreHandle["delete"],

    async exists(table, idOrWhere) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const where: WhereMap =
        typeof idOrWhere === "string"
          ? { [resolvePkColumn(table)]: idOrWhere }
          : normalizeWhereMap(table, idOrWhere);
      const compiled = compileWhere(where);
      if (!compiled.clause) {
        throw new Error("exists() requires at least one where predicate");
      }
      const rows = await connection.query(
        `SELECT 1 AS "ok" FROM ${quoteIdent(name)} WHERE ${compiled.clause} LIMIT 1`,
        compiled.params,
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
              : c.name === "clicks" ||
                  c.name === "qty" ||
                  c.name === "createdAt" ||
                  c.name === "created_at"
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

  return handle;
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
