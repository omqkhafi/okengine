/**
 * Driver-agnostic SQL session used by `fx.store(sqlStore)`.
 *
 * Thin, protocol-agnostic subset — never domain-named helpers.
 * Same flow code runs against sqlite, postgres, and memory.
 */

import type { DomainDdlMode } from "../../config/index.ts";
import type { ClassificationMap, SqlConnection, SqlRow } from "../../drivers/types.ts";
import {
  buildRlsIdentityPreludeSql,
  installOkeRlsHelpers,
  RLS_CONTEXT_DRIVERS,
  type RlsIdentity,
} from "../../drivers/pg-rls.ts";
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

/**
 * Inferred select-row shape for a table handle.
 *
 * Uses `$inferSelect` when present (OKE `store.schema.table()` and Drizzle
 * `pgTable()` / `sqliteTable()`). Bare {@link TableHandle} / `unknown` stay
 * {@link SqlRow}.
 */
export type InferSelectRow<T> = T extends { readonly $inferSelect: infer R } ? R : SqlRow;

/** Serialize stamp frames on a shared connection so concurrent identities cannot interleave. */
const rlsStampTails = new WeakMap<SqlConnection, Promise<unknown>>();

/**
 * Runtime CDC sink — set once by the store runtime at boot. Write hooks call
 * {@link notifySqlCdc} after committed DML; the sink feeds LiveQueryRuntime
 * and (when a driver owns an outbox) durable multi-host delivery.
 */
export interface SqlCdcSink {
  /** Deliver one captured change. */
  (event: {
    readonly tableName: string;
    readonly op: "insert" | "update" | "delete";
    readonly before: Record<string, unknown> | null;
    readonly after: Record<string, unknown> | null;
  }): void | Promise<void>;
}

let sqlCdcSink: SqlCdcSink | null = null;

/**
 * Install the process-wide CDC sink. Idempotent — last install wins.
 *
 * @param sink - Store-runtime-owned delivery target
 */
export function setSqlCdcSink(sink: SqlCdcSink | null): void {
  sqlCdcSink = sink;
}

/**
 * True when `sql` starts with INSERT/UPDATE/DELETE on a domain table
 * (excludes stamp preludes, txn control, DDL — see {@link isRlsStampExemptSql}).
 *
 * @param sql - Statement text with any placeholder style
 */
export function isCdcCandidateSql(sql: string): boolean {
  return (
    /^(insert|update|delete)\b/i.test(sql.trim()) && !/^(delete\s+from\s+oke_)/i.test(sql.trim())
  );
}

/** Fire-and-forget CDC notification (never blocks or fails the write path). */
function notifySqlCdc(event: {
  readonly tableName: string;
  readonly op: "insert" | "update" | "delete";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}): void {
  if (!sqlCdcSink) return;
  try {
    const result = sqlCdcSink(event);
    if (result instanceof Promise) void result.catch(() => undefined);
  } catch {
    // Telemetry must never break writes.
  }
}

/**
 * One helper-installation per CONNECTION, not per session handle.
 *
 * Concurrent identity bags share `sharedSqlConn`; installing per handle races
 * `CREATE OR REPLACE FUNCTION oke.*` on the same `pg_proc` tuple and fails
 * with `tuple concurrently updated`. The install promise is shared so the
 * first stamped op installs and everyone else awaits it.
 */
const rlsHelperInstalls = new WeakMap<SqlConnection, Promise<void>>();

async function ensureOkeRlsHelpers(connection: SqlConnection): Promise<void> {
  let installing = rlsHelperInstalls.get(connection);
  if (!installing) {
    installing = installOkeRlsHelpers((sql) => connection.exec(sql));
    rlsHelperInstalls.set(connection, installing);
    // Failed install must not poison the cache — allow a retry.
    void installing.catch(() => rlsHelperInstalls.delete(connection));
  }
  await installing;
}

/**
 * True when SQL must not enter an RLS identity frame (txn control or DDL).
 *
 * @param sql - Statement
 */
export function isRlsStampExemptSql(sql: string): boolean {
  return /^\s*(begin|commit|rollback|create|alter|drop|truncate|grant|revoke|comment)\b/i.test(sql);
}

/**
 * Run `fn` after any in-flight stamp on `connection` finishes.
 *
 * @param connection - Shared SQL connection
 * @param fn - Stamp frame
 */
async function withRlsStampLock<T>(connection: SqlConnection, fn: () => Promise<T>): Promise<T> {
  const prev = rlsStampTails.get(connection) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  rlsStampTails.set(
    connection,
    prev.then(
      () => gate,
      () => gate,
    ),
  );
  await prev.catch(() => undefined);
  try {
    return await fn();
  } finally {
    release();
  }
}

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
  /** Gate identity — stamps `oke.*` on postgres / pglite. */
  readonly rls?: RlsIdentity;
}

/**
 * Continuations after `.orderBy(...)` — awaitable, optional `.limit` /
 * `.offset`.
 */
export interface SelectOrderBuilder<TRow = SqlRow> extends PromiseLike<TRow[]> {
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<TRow[]>;
  /**
   * Skip the first `n` rows (`LIMIT … OFFSET …`).
   *
   * @param n - Rows to skip
   */
  offset(n: number): Promise<TRow[]>;
}

/**
 * Continuations after `.where(...)` on a select — awaitable, optional
 * `.orderBy(...)` / `.limit(...)` / `.offset(...)`.
 */
export interface SelectWhereBuilder<TRow = SqlRow> extends PromiseLike<TRow[]> {
  /**
   * Order rows with Drizzle `asc()` / `desc()` terms.
   *
   * @param orders - Order terms
   */
  orderBy(...orders: readonly unknown[]): SelectOrderBuilder<TRow>;
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<TRow[]>;
  /**
   * Skip the first `n` rows.
   *
   * @param n - Rows to skip
   */
  offset(n: number): Promise<TRow[]>;
}

/**
 * Result of `.from(table)` — awaitable (all rows) or chain
 * `.where(...)` / `.orderBy(...)` / `.limit(...)` / `.offset(...)` in any
 * order.
 */
export interface SelectFromBuilder<TRow = SqlRow> extends PromiseLike<TRow[]> {
  /**
   * Filter with a plain equality map or a Drizzle SQL condition
   * (`eq`, `and`, `or`, `lt`, `like`, …).
   *
   * @param where - Condition
   */
  where(where: unknown): SelectWhereBuilder<TRow>;
  /**
   * Order rows with Drizzle `asc()` / `desc()` terms.
   *
   * @param orders - Order terms
   */
  orderBy(...orders: readonly unknown[]): SelectOrderBuilder<TRow>;
  /**
   * Cap the number of returned rows.
   *
   * @param n - Max rows
   */
  limit(n: number): Promise<TRow[]>;
  /**
   * Skip the first `n` rows.
   *
   * @param n - Rows to skip
   */
  offset(n: number): Promise<TRow[]>;
}

/**
 * Fluent select builder.
 *
 * `TLocked` is `undefined` for `select()` (row type inferred from `.from`)
 * and {@link SqlRow} for `select({ alias: col })` projections.
 */
export interface SelectBuilder<TLocked extends SqlRow | undefined = undefined> {
  /**
   * Choose the source table.
   *
   * @param table - Table handle or Drizzle table
   */
  from<TTable>(
    table: TTable,
  ): SelectFromBuilder<TLocked extends undefined ? InferSelectRow<TTable> : TLocked>;
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
   * Start a select. No-arg form infers the row from `.from(table)`.
   * A column map (`select({ clicks: links.clicks })`) stays {@link SqlRow}.
   *
   * @param columns - Optional `{ alias: drizzleColumn }` map
   */
  select(): SelectBuilder<undefined>;
  select(columns: unknown): SelectBuilder<SqlRow>;
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
   * DML without `RETURNING` uses `exec` (memory SQL has no generic UPDATE
   * on `query`); SELECT and `RETURNING` still return masked rows.
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
   * `where`. Cannot combine with `offset` or `before`.
   */
  readonly after?: unknown;
  /**
   * Keyset mode — rows strictly before the cursor. Caller flips `orderBy`
   * and reverses the result. Cannot combine with `offset` or `after`.
   */
  readonly before?: unknown;
}

/** True when `sql` is DML/DDL (not a SELECT). */
function isSqlDml(sql: string): boolean {
  return /^(insert|update|delete|create|drop|alter|truncate|replace)\b/i.test(sql.trim());
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
  const { connection, classifications, revealPii, rls } = options;
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
    return withSchemaGuard(() => withRlsStamp((conn) => conn.query(sql, params), sql));
  }

  function exec(sql: string, params: readonly unknown[] = []): Promise<{ changes: number }> {
    return withSchemaGuard(() => withRlsStamp((conn) => conn.exec(sql, params), sql));
  }

  async function withRlsStamp<T>(fn: (conn: SqlConnection) => Promise<T>, sql: string): Promise<T> {
    if (!rls || !RLS_CONTEXT_DRIVERS.has(connection.driverId)) return fn(connection);
    if (isRlsStampExemptSql(sql)) return fn(connection);
    const run = (): Promise<T> => applyRlsStamp(fn);
    // PGlite is one backend session — concurrent identities must not interleave.
    // Pooled postgres pins each stamp via `transaction()` instead.
    if (connection.driverId === "pglite") {
      return withRlsStampLock(connection, run);
    }
    return run();
  }

  async function applyRlsStamp<T>(fn: (conn: SqlConnection) => Promise<T>): Promise<T> {
    if (!rls) return fn(connection);
    await ensureOkeRlsHelpers(connection);
    const frame = async (tx: SqlConnection): Promise<T> => {
      for (const stmt of buildRlsIdentityPreludeSql(rls)) {
        await tx.exec(stmt.sql, stmt.params ?? []);
      }
      return fn(tx);
    };
    if (!connection.transaction) {
      throw new Error("RLS stamp needs SqlConnection.transaction to pin SET LOCAL");
    }
    return connection.transaction(frame);
  }

  async function ensureFromMeta(table: TableHandle | unknown): Promise<void> {
    if (domainDdl !== "ensure") return;
    const cols = resolveColumns(table);
    if (cols.length === 0) return;
    const name = resolveTableName(table);
    const pk = cols.find((c) => c.primary)?.sqlName;
    // ddlTypeOf already widens the int family to BIGINT; memory/SQLite accept
    // it too (dynamic typing), so no per-driver remap is needed.
    void connection.driverId;
    const colSql = cols
      .map((c) => {
        const typ = pk && c.sqlName === pk ? `${c.sqlType} PRIMARY KEY` : c.sqlType;
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

  /**
   * Postgres `row_to_json` images come back as JSON strings on pglite and
   * objects on Bun.SQL — normalize to the JS row mapping (snake→camel).
   *
   * @param table - Table handle for column remapping
   * @param image - Raw RETURNING cell
   */
  function jsonImageToJs(table: TableHandle | unknown, image: unknown): SqlRow | null {
    if (image === null || image === undefined) return null;
    let obj: Record<string, unknown>;
    if (typeof image === "string") {
      try {
        obj = JSON.parse(image) as Record<string, unknown>;
      } catch {
        return null;
      }
    } else if (typeof image === "object") {
      obj = image as Record<string, unknown>;
    } else {
      return null;
    }
    return toJs(table, [obj])[0] ?? null;
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

  const handle = {
    ref,
    routedRole: options.routedRole,
    driverId: connection.driverId,

    select(columns?: unknown) {
      return {
        from(table: TableHandle | unknown) {
          return selectFrom(table, columns);
        },
      };
    },

    insert(table: TableHandle | unknown): InsertBuilder {
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
            const sql = `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders}) RETURNING *`;
            const inserted = await query(sql, params);
            notifySqlCdc({
              tableName: name,
              op: "insert",
              before: null,
              after: toJs(table, inserted)[0] ?? null,
            });
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
              notifySqlCdc({
                tableName: name,
                op: "insert",
                before: null,
                after: (toJs(table, rows)[0] as Record<string, unknown>) ?? null,
              });
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

    update(table: TableHandle | unknown): UpdateBuilder {
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
              const pk = resolvePkColumn(table);
              const setParams = setEntries.map(([, v]) => v);

              // Single-statement before capture (postgres / pglite): the
              // `__oke_old` CTE snapshots matched pre-images FOR UPDATE,
              // joins the UPDATE, and RETURNING emits both JSON images in
              // one round-trip. Binding order follows marker appearance:
              // CTE(where) params first, then SET values.
              if (RLS_CONTEXT_DRIVERS.has(connection.driverId)) {
                const sql =
                  `WITH __oke_old AS (` +
                  `SELECT * FROM ${quoteIdent(name)} WHERE ${compiled.clause} FOR UPDATE` +
                  `)` +
                  ` UPDATE ${quoteIdent(name)} SET ${setSql}` +
                  ` FROM __oke_old` +
                  ` WHERE ${quoteIdent(name)}.${quoteIdent(pk)} = __oke_old.${quoteIdent(pk)}` +
                  ` RETURNING row_to_json(__oke_old) AS __oke_before_data, row_to_json(${quoteIdent(name)}) AS __oke_after_data`;
                const result = await query(sql, [...compiled.params, ...setParams]);
                for (const rawRow of result) {
                  notifySqlCdc({
                    tableName: name,
                    op: "update",
                    before: jsonImageToJs(table, rawRow.__oke_before_data),
                    after: jsonImageToJs(table, rawRow.__oke_after_data),
                  });
                }
                return result.length;
              }

              // Fallback (memory): explicit pre-read then plain DML — the
              // hook still emits true before-images, just via two statements.
              const prior = await query(
                `SELECT * FROM ${quoteIdent(name)} WHERE ${compiled.clause}`,
                compiled.params,
              );
              const result = await exec(
                `UPDATE ${quoteIdent(name)} SET ${setSql} WHERE ${compiled.clause}`,
                [...setParams, ...compiled.params],
              );
              for (const beforeRow of toJs(table, prior)) {
                notifySqlCdc({
                  tableName: name,
                  op: "update",
                  before: beforeRow,
                  after: { ...beforeRow },
                });
              }
              return result.changes;
            },
          };
        },
      };
    },

    async findById(table: TableHandle | unknown, idValue: string) {
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
          // DELETE ... RETURNING * gives the full last image in one statement.
          const rows = await query(
            `DELETE FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ? RETURNING *`,
            [idValue],
          );
          if (rows.length === 0) return false;
          notifySqlCdc({
            tableName: name,
            op: "delete",
            before: toJs(table, rows)[0] ?? null,
            after: null,
          });
          return true;
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
          const rows = await query(
            `DELETE FROM ${quoteIdent(name)} WHERE ${compiled.clause} RETURNING *`,
            compiled.params,
          );
          for (const beforeRow of toJs(table, rows)) {
            notifySqlCdc({ tableName: name, op: "delete", before: beforeRow, after: null });
          }
          return rows.length;
        },
      };
      return builder;
    }) as SqlStoreHandle["delete"],

    async exists(table: TableHandle | unknown, idOrWhere: string | WhereMap) {
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

    async upsert(
      table: TableHandle | unknown,
      matchOn: WhereMap | unknown,
      values: SqlRow,
      upsertOptions?: { readonly onExisting?: "update" },
    ) {
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
        const rows = await query(
          `INSERT INTO ${quoteIdent(name)} (${colList}) VALUES (${placeholders}) RETURNING *`,
          params,
        );
        notifySqlCdc({
          tableName: name,
          op: "insert",
          before: null,
          after: toJs(table, rows)[0] ?? null,
        });
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
      if (RLS_CONTEXT_DRIVERS.has(connection.driverId)) {
        // Single-statement before/after capture — same shape as update().
        // SET may include the PK (upsert keys) — exclude it from the UPDATE
        // list to keep param order and row identity stable.
        const pkCol = resolvePkColumn(table);
        const setEntriesNoPk = setEntries.filter(([col]) => col !== pkCol);
        const setSqlNoPk = setEntriesNoPk.map(([col]) => `${quoteIdent(col)} = ?`).join(", ");
        const sql =
          `WITH __oke_old AS (` +
          `SELECT * FROM ${quoteIdent(name)} WHERE ${compiled.clause} FOR UPDATE` +
          `)` +
          ` UPDATE ${quoteIdent(name)} SET ${setSqlNoPk}` +
          ` FROM __oke_old` +
          ` WHERE ${quoteIdent(name)}.${quoteIdent(pkCol)} = __oke_old.${quoteIdent(pkCol)}` +
          ` RETURNING row_to_json(__oke_old) AS __oke_before_data, row_to_json(${quoteIdent(name)}) AS __oke_after_data`;
        const result = await query(sql, [...compiled.params, ...setEntriesNoPk.map(([, v]) => v)]);
        for (const rawRow of result) {
          notifySqlCdc({
            tableName: name,
            op: "update",
            before: jsonImageToJs(table, rawRow.__oke_before_data),
            after: jsonImageToJs(table, rawRow.__oke_after_data),
          });
        }
        return { status: "changed" as const };
      }
      const prior = await query(
        `SELECT * FROM ${quoteIdent(name)} WHERE ${compiled.clause}`,
        compiled.params,
      );
      await exec(`UPDATE ${quoteIdent(name)} SET ${setSql} WHERE ${compiled.clause}`, params);
      for (const beforeRow of toJs(table, prior)) {
        notifySqlCdc({
          tableName: name,
          op: "update",
          before: beforeRow,
          after: { ...beforeRow, ...values },
        });
      }
      return { status: "changed" as const };
    },

    async increment(table: TableHandle | unknown, idValue: string, column: string, by = 1) {
      await ensureFromMeta(table);
      const name = resolveTableName(table);
      const pk = resolvePkColumn(table);
      const cols = resolveColumns(table);
      const colMeta = cols.find((c) => c.key === column || c.sqlName === column);
      const sqlCol = colMeta?.sqlName ?? column;
      const col = quoteIdent(sqlCol);
      if (RLS_CONTEXT_DRIVERS.has(connection.driverId)) {
        // Single statement: the CTE locks the row and carries only the PK
        // (projecting more would make the bare SET target ambiguous against
        // __oke_old's columns), UPDATE returns the after-image and new value
        // in one round-trip.
        const sql =
          `WITH __oke_old AS (` +
          `SELECT ${quoteIdent(pk)} FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ? FOR UPDATE` +
          `)` +
          ` UPDATE ${quoteIdent(name)} SET ${col} = ${col} + ?` +
          ` FROM __oke_old` +
          ` WHERE ${quoteIdent(name)}.${quoteIdent(pk)} = __oke_old.${quoteIdent(pk)}` +
          ` RETURNING row_to_json(${quoteIdent(name)}) AS __oke_after_data, ${col}`;
        const result = await query(sql, [idValue, by]);
        const row = result[0];
        if (!row) {
          throw new Error(`increment(): no row with ${pk} ${JSON.stringify(idValue)} in ${name}`);
        }
        notifySqlCdc({
          tableName: name,
          op: "update",
          // No full pre-image in this single statement — the CTE projects
          // just the PK. The runtime classifies a numeric-only mutation as
          // an upsert event; revocation never needs this before-image.
          before: null,
          after: jsonImageToJs(table, row.__oke_after_data),
        });
        return asNumber(row[sqlCol], sqlCol);
      }
      const prior = await query(`SELECT * FROM ${quoteIdent(name)} WHERE ${quoteIdent(pk)} = ?`, [
        idValue,
      ]);
      const rows = await query(
        `UPDATE ${quoteIdent(name)} SET ${col} = ${col} + ? WHERE ${quoteIdent(pk)} = ? RETURNING ${col}`,
        [by, idValue],
      );
      const row = rows[0];
      if (!row) {
        throw new Error(`increment(): no row with ${pk} ${JSON.stringify(idValue)} in ${name}`);
      }
      notifySqlCdc({
        tableName: name,
        op: "update",
        before: toJs(table, prior)[0] ?? null,
        after: null,
      });
      return asNumber(row[sqlCol], sqlCol);
    },

    async raw(sql: string, params: readonly unknown[] = []) {
      const table = tableFromSql(sql);
      // Memory SQL (console-next seed) implements DML on `exec`, not `query`.
      // SELECT / RETURNING still go through `query` so callers get rows.
      if (isSqlDml(sql) && !/\breturning\b/i.test(sql)) {
        const result = await exec(sql, params);
        return [{ changes: result.changes }];
      }
      const rows = await query(sql, params);
      return mask(rows, table);
    },

    async count(table: TableHandle | unknown, where?: unknown) {
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

    async page(table: TableHandle | unknown, options: SqlPageOptions) {
      if (options.after !== undefined && options.before !== undefined) {
        throw new Error("page(): after and before (keyset) cannot combine");
      }
      if (
        options.offset !== undefined &&
        (options.after !== undefined || options.before !== undefined)
      ) {
        throw new Error("page(): offset and keyset (after/before) cannot combine");
      }
      const keyset = options.after ?? options.before;
      const where =
        keyset === undefined
          ? options.where
          : options.where === undefined
            ? keyset
            : andWhere(options.where, keyset);
      return runSelect(table, null, {
        where,
        orders: options.orderBy,
        limit: options.limit,
        offset: options.offset,
      });
    },

    async ensureTable(table: TableHandle) {
      const cols = Object.values(table.columns);
      const pk = resolvePkColumn(table);
      const colSql = cols
        .map((c) => {
          const typ = c.name === pk ? "TEXT PRIMARY KEY" : "TEXT";
          return `${quoteIdent(c.name)} ${typ}`;
        })
        .join(", ");
      await exec(`CREATE TABLE IF NOT EXISTS ${quoteIdent(resolveTableName(table))} (${colSql})`);
    },
  };

  return handle as SqlStoreHandle;
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
