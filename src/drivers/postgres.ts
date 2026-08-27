/**
 * `postgres` driver — binds `Bun.SQL` (never `pg` / postgres.js).
 *
 * Protocol-named: Neon, Supabase, RDS, Timescale all speak postgres.
 */

import type { SqlConnectOptions, SqlConnection, SqlDriver, SqlRole, SqlRow } from "./types.ts";

/** Bun.SQL client checked out via {@link PostgresClientLike.reserve}. */
export interface PostgresReservedClient extends PostgresClientLike {
  /** Return the connection to the pool. */
  release(): void;
}

/** Minimal surface we use from Bun.SQL (and test fakes). */
export interface PostgresClientLike {
  unsafe(
    sql: string,
    values?: unknown[],
  ): PromiseLike<SqlRow[] | { length: number; changes?: number } | SqlRow[]>;
  /**
   * Pin one pooled TCP connection. Required in front of PgDog — `begin()`
   * then `unsafe()` on the parent client can checkout a second slot and
   * deadlock the pool (`checkout timeout`).
   */
  reserve?(): Promise<PostgresReservedClient>;
  /**
   * Reserve one pooled connection for a transaction (Bun.SQL).
   *
   * @param fn - Work on the reserved client
   */
  begin?<T>(fn: (tx: PostgresClientLike) => Promise<T> | T): Promise<T>;
  close?(options?: { timeout?: number }): Promise<void>;
}

/** Cap shared Bun.SQL pools so one process cannot outrun PgDog (default 10). */
export const POSTGRES_POOL_MAX = 8;

const sharedClients = new Map<string, PostgresClientLike>();

/**
 * Resolve the Postgres URL (injected, `DATABASE_URL`, then localhost).
 *
 * @param url - Explicit URL
 */
export function resolvePostgresUrl(url?: string): string {
  return url ?? process.env.DATABASE_URL ?? "postgres://localhost:5432/oke";
}

/**
 * One Bun.SQL pool per URL for store / journal / clock / vault / console.
 *
 * @param url - Connection URL
 */
export function sharedPostgresClient(url?: string): PostgresClientLike {
  const key = resolvePostgresUrl(url);
  const existing = sharedClients.get(key);
  if (existing) return existing;
  const created = new Bun.SQL(key, { max: POSTGRES_POOL_MAX }) as unknown as PostgresClientLike;
  sharedClients.set(key, created);
  return created;
}

/**
 * Pin one pooled connection, `BEGIN`, run `fn`, `COMMIT`/`ROLLBACK`, release.
 *
 * Prefer `reserve()` — Bun.SQL `begin()` then `unsafe()` on the parent
 * client can checkout a second slot and deadlock PgDog.
 *
 * @param client - Pool or test fake
 * @param fn - Work on the pinned client
 */
export async function withPinnedPostgres<T>(
  client: PostgresClientLike,
  fn: (tx: PostgresClientLike) => Promise<T>,
): Promise<T> {
  if (typeof client.reserve === "function") {
    const reserved = await client.reserve();
    try {
      await reserved.unsafe("BEGIN");
      try {
        const result = await fn(reserved);
        await reserved.unsafe("COMMIT");
        return result;
      } catch (err) {
        try {
          await reserved.unsafe("ROLLBACK");
        } catch {
          // Already aborted.
        }
        throw err;
      }
    } finally {
      reserved.release();
    }
  }
  if (typeof client.begin === "function") {
    return client.begin(fn);
  }
  throw new Error("postgres client needs reserve() or begin() to pin a transaction");
}

/**
 * Convert `?` placeholders to Postgres `$1…$n`.
 * Leaves SQL unchanged when there are no bound values so operators
 * like `jsonb ? key` are not rewritten.
 *
 * @param sql - SQL with `?` placeholders
 * @param values - Bound values (empty skips conversion)
 */
export function toPostgresParams(sql: string, values: readonly unknown[] = []): string {
  if (values.length === 0) return sql;
  let i = 0;
  return sql.replace(/\?/g, () => `$${++i}`);
}

/**
 * Open a Postgres connection via Bun.SQL.
 *
 * @param options - URL / role / injected client
 */
export async function connectPostgres(options: SqlConnectOptions = {}): Promise<SqlConnection> {
  const role = options.role ?? "primary";
  const injected = options.client as PostgresClientLike | undefined;
  // Dedicated single-connection client (pool.max === 1): workloads that hold
  // manual transaction state across many statements (e.g. vault rotateMaster)
  // must not share a pooled client — Bun raises ERR_POSTGRES_UNSAFE_TRANSACTION
  // when raw statements interleave with open transaction state on the shared
  // pool. Opt in explicitly; default behavior is unchanged.
  const dedicated = !injected && options.pool?.max === 1;
  const client =
    injected ??
    (dedicated
      ? dedicatedPostgresClient(resolvePostgresUrl(options.url))
      : sharedPostgresClient(options.url));
  return wrapPostgresClient(client, role, {
    shared: injected === undefined && !dedicated,
  });
}

/** Standalone one-connection Bun.SQL client — closed with its SqlConnection. */
function dedicatedPostgresClient(url: string): PostgresClientLike {
  return new Bun.SQL(url, { max: 1 }) as unknown as PostgresClientLike;
}

/**
 * Bind a Bun.SQL-compatible client as {@link SqlConnection}.
 *
 * @param client - Pool or reserved transaction client
 * @param role - Primary vs replica
 * @param opts - Shared-pool / already-pinned flags
 */
function wrapPostgresClient(
  client: PostgresClientLike,
  role: SqlRole,
  opts: { readonly shared?: boolean; readonly pinned?: boolean } = {},
): SqlConnection {
  const connection: SqlConnection = {
    driverId: "postgres",
    role,
    async query(sql, params = []) {
      const pg = toPostgresParams(sql, params);
      const result = await client.unsafe(pg, [...params]);
      if (Array.isArray(result)) return result as SqlRow[];
      return Array.from(result as ArrayLike<SqlRow>);
    },
    async exec(sql, params = []) {
      const pg = toPostgresParams(sql, params);
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
    async transaction(fn) {
      if (opts.pinned) return fn(connection);
      return withPinnedPostgres(client, (tx) => fn(wrapPostgresClient(tx, role, { pinned: true })));
    },
    async close() {
      if (!opts.shared) await client.close?.();
    },
  };
  return connection;
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
    async begin(fn) {
      return fn(this);
    },
    async reserve() {
      return Object.assign(this, {
        release() {
          /* fake has no pool */
        },
      });
    },
    async unsafe(sql, values = []) {
      const text = sql.trim();
      // Accept both ? (pre-conversion) and $n forms.
      const normalised = text.replace(/\$\d+/g, "?");
      if (
        /^(begin|commit|rollback|set\b|select set_config|create\b|grant\b|do\b|alter\b)\b/i.test(
          normalised,
        )
      ) {
        return [];
      }

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

      const exists =
        /^SELECT\s+1\s+AS\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+FROM\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+WHERE\s+(.+?)\s+LIMIT\s+1\s*$/i.exec(
          normalised,
        );
      if (exists) {
        const rows = tables.get(parseIdent(exists[2]!)) ?? [];
        const preds = parseEqualityWhere(exists[3]!);
        const hit = rows.some((r) => preds.every((p, i) => r[p] === values[i]));
        return hit ? [{ [parseIdent(exists[1]!)]: 1 }] : [];
      }

      const updateReturning =
        /^UPDATE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s+SET\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*\+\s*\?\s+WHERE\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?\s+RETURNING\s+("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*$/i.exec(
          normalised,
        );
      if (updateReturning) {
        const name = parseIdent(updateReturning[1]!);
        const setCol = parseIdent(updateReturning[2]!);
        const addCol = parseIdent(updateReturning[3]!);
        const whereCol = parseIdent(updateReturning[4]!);
        const retCol = parseIdent(updateReturning[5]!);
        if (setCol !== addCol || setCol !== retCol) {
          throw new Error(`postgres fake: unsupported SQL: ${sql}`);
        }
        const list = tables.get(name) ?? [];
        const row = list.find((r) => r[whereCol] === values[1]);
        if (!row) return [];
        const next = Number(row[setCol] ?? 0) + Number(values[0]);
        row[setCol] = next;
        return [{ [retCol]: next }];
      }

      // CTE-shaped atomic increment with jsonb image capture:
      // WITH __oke_old AS (SELECT "pk" FROM t WHERE "pk" = ? FOR UPDATE)
      //   UPDATE t SET "col" = "col" + ? FROM __oke_old
      //   WHERE t."pk" = __oke_old."pk"
      //   RETURNING row_to_json(t) AS __oke_after_data, "col"
      const cteIncrement =
        /^WITH\s+__oke_old\s+AS\s+\(SELECT\s+("?[\w]+"?)\s+FROM\s+("?[\w]+"?)\s+WHERE\s+"?[\w]+"?\s*=\s*\?\s+FOR\s+UPDATE\)\s+UPDATE\s+("?[\w]+"?)\s+SET\s+("?[\w]+"?)\s*=\s*("?[\w]+"?)\s*\+\s*\?\s+FROM\s+__oke_old\s+WHERE\s+("?[\w]+")\."?[\w]+"?\s*=\s*__oke_old\."?[\w]+"?\s+RETURNING\s+row_to_json\(("?[\w]+")\)\s+AS\s+__oke_after_data,\s*("?[\w]+"?)\s*$/i.exec(
          normalised,
        );
      if (cteIncrement) {
        const whereTable = parseIdent(cteIncrement[2]!);
        const updateTable = parseIdent(cteIncrement[3]!);
        const setCol = parseIdent(cteIncrement[4]!);
        const addCol = parseIdent(cteIncrement[5]!);
        const retCol = parseIdent(cteIncrement[8]!);
        if (whereTable !== updateTable || setCol !== addCol || setCol !== retCol) {
          throw new Error(`postgres fake: unsupported SQL: ${sql}`);
        }
        const list = tables.get(updateTable) ?? [];
        const row = list.find((r) => r[parseIdent(cteIncrement[1]!)] === values[0]);
        if (!row) return [];
        const next = Number(row[setCol] ?? 0) + Number(values[1]);
        row[setCol] = next;
        return [{ __oke_after_data: { ...row }, [retCol]: next }];
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

/** Parse `col = ? AND col2 = ?` into ordered column names. */
function parseEqualityWhere(clause: string): string[] {
  return clause.split(/\s+AND\s+/i).map((part) => {
    const m = /^("?[a-zA-Z_][a-zA-Z0-9_]*"?)\s*=\s*\?$/.exec(part.trim());
    if (!m) throw new Error(`postgres fake: unsupported WHERE: ${clause}`);
    return m[1]!.replaceAll('"', "").trim();
  });
}

/** Protocol-named postgres driver. */
export const postgresDriver: SqlDriver = {
  id: "postgres",
  facet: "sql",
  connect: connectPostgres,
};
