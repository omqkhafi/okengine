/**
 * Driver-agnostic SQL session used by `fx.store(sqlStore)`.
 *
 * Thin, protocol-agnostic subset — never domain-named helpers.
 * Same flow code runs against sqlite, postgres, and memory.
 */

import type { DomainDdlMode } from "../../config/index.ts";
import type { ClassificationMap, SqlConnection, SqlRow } from "../../drivers/types.ts";
import { throwOke } from "../../kernel/errors.ts";
import { maskRows, tableFromSql } from "./classify.ts";
import { isMissingDomainRelationError } from "./missing-relation.ts";
import {
  andWhere,
  compileOrderBy,
  compileWhere,
  resolveSelectColumns,
  type WhereMap,
} from "./sql-condition.ts";
import {
  mapRowToJs,
  prepareInsertRow,
  prepareUpdateRow,
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
  /**
   * Domain DDL policy. `ensure` runs `CREATE TABLE IF NOT EXISTS` on first
   * touch; `off` means migrations / `oke db push` own the schema (docker/prod
   * and local+autoPush). Default `ensure` for backward-compatible tests.
   */
  readonly domainDdl?: DomainDdlMode;
}

/**
 * Continuations after `.orderBy(...)` — awaitable, optional `.limit` /
 * `.offset`.
 */
export interface SelectOrderBuilder extends PromiseLike<SqlRow[]> {
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<SqlRow[]>;
  /**
   * Skip the first `n` rows (`LIMIT … OFFSET …`).
   *
   * @param n - Rows to skip
   */
  offset(n: number): Promise<SqlRow[]>;
}

/**
 * Continuations after `.where(...)` on a select — awaitable, optional
 * `.orderBy(...)` / `.limit(...)` / `.offset(...)`.
 */
export interface SelectWhereBuilder extends PromiseLike<SqlRow[]> {
  /**
   * Order rows with Drizzle `asc()` / `desc()` terms.
   *
   * @param orders - Order terms
   */
  orderBy(...orders: readonly unknown[]): SelectOrderBuilder;
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<SqlRow[]>;
  /**
   * Skip the first `n` rows.
   *
   * @param n - Rows to skip
   */
  offset(n: number): Promise<SqlRow[]>;
}

/**
 * Result of `.from(table)` — awaitable (all rows) or chain
 * `.where(...)` / `.orderBy(...)` / `.limit(...)` / `.offset(...)` in any
 * order.
 */
export interface SelectFromBuilder extends PromiseLike<SqlRow[]> {
  /**
   * Filter with a plain equality map or a Drizzle SQL condition
   * (`eq`, `and`, `or`, `lt`, `like`, …).
   *
   * @param where - Condition
   */
  where(where: unknown): SelectWhereBuilder;
  /**
   * Order rows with Drizzle `asc()` / `desc()` terms.
   *
   * @param orders - Order terms
   */
  orderBy(...orders: readonly unknown[]): SelectOrderBuilder;
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<SqlRow[]>;
  /**
   * Skip the first `n` rows.
   *
   * @param n - Rows to skip
   */
  offset(n: number): Promise<SqlRow[]>;
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
  exists(table: TableHandle | unknown, idOrWhere: string | WhereMap): Promise<boolean>;
  /**
   * Insert when no row matches `matchOn`; never touches an existing match
   * unless `options.onExisting` is `"update"`.
   *
   * @param table - Table
   * @param matchOn - Equality map or Drizzle condition identifying the row
   * @param values - Row values for insert (and optional update)
   * @param options - Per-call opt-in to update an existing match
   */
  upsert(
    table: TableHandle | unknown,
    matchOn: WhereMap | unknown,
    values: SqlRow,
    options?: { readonly onExisting?: "update" },
  ): Promise<UpsertResult>;
  /**
   * Atomically add `by` to `column` on the PK row.
   *
   * @param table - Table
   * @param id - Primary key value
   * @param column - Numeric column to bump
   * @param by - Delta (default `1`)
   */
  increment(table: TableHandle | unknown, id: string, column: string, by?: number): Promise<number>;
  /**
   * Raw SQL — PII masking still applied at the boundary.
   *
   * @param sql - SQL with `?` placeholders
   * @param params - Bound parameters
   */
  raw(sql: string, params?: readonly unknown[]): Promise<SqlRow[]>;
  /**
   * Count rows (`COUNT(*)`), optionally filtered.
   *
   * @param table - Table
   * @param where - Optional condition
   */
  count(table: TableHandle | unknown, where?: unknown): Promise<number>;
  /**
   * One page of rows — offset or keyset mode, composed through the same
   * fluent select path (Drizzle conditions in, `compileWhere` out).
   *
   * @param table - Table
   * @param options - Page options
   */
  page(table: TableHandle | unknown, options: SqlPageOptions): Promise<SqlRow[]>;
  /**
   * Ensure a simple table exists (test / bootstrap helper).
   *
   * @param table - Table handle
   */
  ensureTable(table: TableHandle): Promise<void>;
}

/** Outcome of {@link SqlStoreHandle.upsert}. */
export type UpsertStatus = "upserted" | "changed" | "already-existed";

/** Result envelope for {@link SqlStoreHandle.upsert}. */
export interface UpsertResult {
  readonly status: UpsertStatus;
}

/** Options for {@link SqlStoreHandle.page}. */
export interface SqlPageOptions {
  /** Filter condition (equality map or Drizzle SQL). */
  readonly where?: unknown;
  /** Drizzle `asc()` / `desc()` terms (or bare columns). */
  readonly orderBy?: readonly unknown[];
  /** Max rows to return. */
  readonly limit?: number;
  /** Offset mode — skip rows (uses `OFFSET`). */
  readonly offset?: number;
  /**
   * Keyset mode — a Drizzle SQL condition describing "rows strictly after
   * the cursor" (composed by the caller / `store.resource`); ANDed onto
   * `where`. Cannot combine with `offset`.
   */
  readonly after?: unknown;
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
  const domainDdl: DomainDdlMode = options.domainDdl ?? "ensure";

  function mask(rows: SqlRow[], table?: string): SqlRow[] {
    return maskRows(rows, { classifications, table, revealPii });
  }

  /**
   * Run a connection op; remap missing-relation driver errors to OKE1101
   * when domain auto-DDL is off.
   */
  async function withSchemaGuard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (domainDdl === "off" && isMissingDomainRelationError(err)) {
        throwOke("DOMAIN_SCHEMA_MISSING");
      }
      throw err;
    }
  }

  function query(sql: string, params: readonly unknown[] = []): Promise<SqlRow[]> {
    return withSchemaGuard(() => connection.query(sql, params));
  }

  function exec(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
    return withSchemaGuard(() => connection.exec(sql, params));
  }

  async function ensureFromMeta(table: TableHandle | unknown): Promise<void> {
    if (domainDdl !== "ensure") return;
    const cols = resolveColumns(table);
    if (cols.length === 0) return;
    const name = resolveTableName(table);
    const pk = cols.find((c) => c.primary)?.sqlName;
    // Postgres/PGLite INTEGER is 32-bit — abstract `integer` (ms timestamps via
    // `now`) must map to BIGINT. SQLite INTEGER is flexible up to 64-bit.
    const pgWideInt = connection.driverId === "postgres" || connection.driverId === "pglite";
    const colSql = cols
      .map((c) => {
        const base = pgWideInt && c.sqlType === "INTEGER" ? "BIGINT" : c.sqlType;
        const typ = pk && c.sqlName === pk ? `${base} PRIMARY KEY` : base;
        return `${quoteIdent(c.sqlName)} ${typ}`;
      })
      .join(", ");
    await exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(name)} (${colSql})`);
  }

  function toJs(table: TableHandle | unknown, rows: SqlRow[]): SqlRow[] {
    return rows.map((r) => mapRowToJs(table, r) as SqlRow);
  }

  function normalizeWhereMap(table: TableHandle | unknown, where: WhereMap): WhereMap {
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

  /** Accumulated select state across the fluent chain. */
  interface SelectPlan {
    readonly where?: unknown;
    readonly orders?: readonly unknown[];
    readonly limit?: number;
    readonly offset?: number;
  }

  async function runSelect(
    table: TableHandle | unknown,
    projection: ReturnType<typeof resolveSelectColumns>,
    plan: SelectPlan = {},
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
    if (plan.where !== undefined) {
      const compiled = compileTableWhere(table, plan.where);
      if (compiled.clause) {
        sql += ` WHERE ${compiled.clause}`;
        params.push(...compiled.params);
      }
    }
    if (plan.orders !== undefined && plan.orders.length > 0) {
      const terms = compileOrderBy(plan.orders);
      sql += ` ORDER BY ${terms.map((o) => `${quoteIdent(o.column)} ${o.direction}`).join(", ")}`;
    }
    if (plan.limit !== undefined) {
      sql += ` LIMIT ${Math.max(0, Math.floor(plan.limit))}`;
    }
    if (plan.offset !== undefined) {
      sql += ` OFFSET ${Math.max(0, Math.floor(plan.offset))}`;
    }

    const rows = await query(sql, params);
    // Map to declared JS keys first, then mask — classifications are keyed by
    // TS field names (`email`), so masking before remapping would miss a
    // `.pii()` column whose SQL name differs (`email_addr`) and leak cleartext
    // under the final client-facing key.
    if (projection === null) {
      return mask(toJs(table, rows), name);
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

  function selectFrom(table: TableHandle | unknown, columns?: unknown): SelectFromBuilder {
    const projection = resolveSelectColumns(columns);

    // Builders are lazy: the query runs on the first await / `.limit(n)` /
    // `.offset(n)`, so a chained `where → orderBy → limit` issues one SELECT.
    function tail(plan: SelectPlan): SelectOrderBuilder {
      return {
        limit(n) {
          return runSelect(table, projection, { ...plan, limit: n });
        },
        offset(n) {
          return runSelect(table, projection, { ...plan, offset: n });
        },
        then(onfulfilled, onrejected) {
          return runSelect(table, projection, plan).then(onfulfilled, onrejected);
        },
      };
    }

    function filtered(where: unknown): SelectWhereBuilder {
      const plan: SelectPlan = where === undefined ? {} : { where };
      return {
        ...tail(plan),
        orderBy(...orders) {
          return tail({ ...plan, orders });
        },
      };
    }

    return {
      ...filtered(undefined),
      where(where) {
        return filtered(where);
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
            await exec(sql, params);
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
              const rows = await query(sql, params);
              return mask(toJs(table, rows), name);
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
              const prepared = prepareUpdateRow(table, row);
              const setEntries = Object.entries(prepared);
              if (setEntries.length === 0) return 0;
              const setSql = setEntries.map(([col]) => `${quoteIdent(col)} = ?`).join(", ");
              const compiled = compileTableWhere(table, where);
              if (!compiled.clause) {
                throw new Error("update().set().where(): condition required");
              }
              const params = [...setEntries.map(([, v]) => v), ...compiled.params];
              const result = await exec(
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
      const rows = await query(`SELECT * FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ?`, [
        idValue,
      ]);
      const masked = mask(toJs(table, rows), name);
      return masked[0] ?? null;
    },

    delete: ((table: TableHandle | unknown, idValue?: string): DeleteBuilder | Promise<boolean> => {
      if (idValue !== undefined) {
        return (async () => {
          await ensureFromMeta(table);
          const name = resolveTableName(table);
          const pk = resolvePkColumn(table);
          const result = await exec(`DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ?`, [
            idValue,
          ]);
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
          const result = await exec(
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
      const rows = await query(
        `SELECT 1 AS "ok" FROM ${quoteIdent(name)} WHERE ${compiled.clause} LIMIT 1`,
        compiled.params,
      );
      return rows.length > 0;
    },

    async upsert(table, matchOn, values, upsertOptions) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const compiled = compileTableWhere(table, matchOn);
      if (!compiled.clause) {
        throw new Error("upsert() requires at least one matchOn predicate");
      }
      const found = await query(
        `SELECT 1 AS "ok" FROM ${quoteIdent(name)} WHERE ${compiled.clause} LIMIT 1`,
        compiled.params,
      );
      if (found.length === 0) {
        const prepared = prepareInsertRow(table, values);
        const cols = Object.keys(prepared);
        const placeholders = cols.map(() => "?").join(", ");
        const colList = cols.map(quoteIdent).join(", ");
        const params = cols.map((c) => prepared[c]);
        await exec(`INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders})`, params);
        return { status: "upserted" as const };
      }
      if (upsertOptions?.onExisting !== "update") {
        return { status: "already-existed" as const };
      }
      const prepared = prepareUpdateRow(table, values);
      const setEntries = Object.entries(prepared);
      if (setEntries.length === 0) return { status: "changed" as const };
      const setSql = setEntries.map(([col]) => `${quoteIdent(col)} = ?`).join(", ");
      const params = [...setEntries.map(([, v]) => v), ...compiled.params];
      await exec(`UPDATE ${quoteIdent(name)} SET ${setSql} WHERE ${compiled.clause}`, params);
      return { status: "changed" as const };
    },

    async increment(table, idValue, column, by = 1) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const pk = resolvePkColumn(table);
      const cols = resolveColumns(table);
      const colMeta = cols.find((c) => c.key === column || c.sqlName === column);
      const sqlCol = colMeta?.sqlName ?? column;
      const col = quoteIdent(sqlCol);
      const rows = await query(
        `UPDATE ${quoteIdent(name)} SET ${col} = ${col} + ? WHERE ${quoteIdent(pk)} = ? RETURNING ${col}`,
        [by, idValue],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`increment(): no row with ${pk} ${JSON.stringify(idValue)} in ${name}`);
      }
      return asNumber(row[sqlCol], sqlCol);
    },

    async raw(sql, params = []) {
      const table = tableFromSql(sql);
      const rows = await query(sql, params);
      return mask(rows, table);
    },

    async count(table, where) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      let sql = `SELECT COUNT(*) AS "count" FROM ${quoteIdent(name)}`;
      const params: unknown[] = [];
      if (where !== undefined) {
        const compiled = compileTableWhere(table, where);
        if (compiled.clause) {
          sql += ` WHERE ${compiled.clause}`;
          params.push(...compiled.params);
        }
      }
      const rows = await query(sql, params);
      return asNumber(rows[0]?.count ?? rows[0]?.COUNT ?? 0, "count");
    },

    async page(table, options) {
      if (options.offset !== undefined && options.after !== undefined) {
        throw new Error("page(): offset and after (keyset) cannot combine");
      }
      const where =
        options.after === undefined
          ? options.where
          : options.where === undefined
            ? options.after
            : andWhere(options.where, options.after);
      return runSelect(table, null, {
        where,
        orders: options.orderBy,
        limit: options.limit,
        offset: options.offset,
      });
    },

    async ensureTable(table) {
      const cols = Object.values(table.columns);
      const pk = resolvePkColumn(table);
      const intType =
        connection.driverId === "postgres" || connection.driverId === "pglite"
          ? "BIGINT"
          : "INTEGER";
      const colSql = cols
        .map((c) => {
          const typ =
            c.name === pk
              ? "TEXT PRIMARY KEY"
              : c.name === "clicks" ||
                  c.name === "qty" ||
                  c.name === "createdAt" ||
                  c.name === "created_at"
                ? intType
                : "TEXT";
          return `${quoteIdent(c.name)} ${typ}`;
        })
        .join(", ");
      await exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(table.name)} (${colSql})`);
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
