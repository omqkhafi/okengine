/**
 * `postgres` clock driver — multi-host CronStore via SKIP LOCKED + lease reclaim.
 *
 * Same concurrency physics as Signal's `once` delivery (`signal-postgres.ts`):
 * claim with `FOR UPDATE SKIP LOCKED`; a crashed holder's lease is reclaimed
 * lazily on the next claim attempt (no sweeper).
 */

import type { CronRow, CronStatus, CronStore } from "../elements/clock/reconcile.ts";
import {
  resolvePostgresUrl,
  sharedPostgresClient,
  toPostgresParams,
  withPinnedPostgres,
  type PostgresClientLike,
} from "./postgres.ts";

/** Row shape in `oke_crons` (lease columns mirror `oke_signal_messages`). */
interface CronDbRow {
  name: string;
  declared_cron: string | null;
  declared_every: string | null;
  override_cron: string | null;
  override_every: string | null;
  effective_cron: string | null;
  effective_every: string | null;
  timezone: string;
  overridable: boolean | number;
  status: string;
  locked_by: string | null;
  lease_expires_at: number | null;
  last_run_at: number | null;
  next_run_at: number | null;
  dst_ambiguity: string | null;
}

/** Minimal SQL + transaction surface for the postgres cron store. */
export interface PostgresCronSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  /**
   * Run `fn` inside a transaction. Nested calls join the outer txn.
   *
   * @param fn - Body
   */
  begin<T>(fn: (sql: PostgresCronSql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Claim a cron row for lease acquire / renew / reclaim.
 *
 * Claimable when unlocked, same holder renewing, or lease expired
 * (lazy reclaim — matches Signal's once-claim predicate).
 */
const CLAIM_LEASE_SQL = `SELECT * FROM oke_crons WHERE name=? AND ((locked_by IS NULL) OR (locked_by=?) OR (lease_expires_at IS NOT NULL AND lease_expires_at<=?)) FOR UPDATE SKIP LOCKED`;

/** Options for {@link createPostgresCronStore}. */
export interface CreatePostgresCronStoreOptions {
  /** Postgres connection URL (Bun.SQL). Ignored when `sql` is injected. */
  readonly url?: string;
  /** Injected SQL surface (tests / fakes). */
  readonly sql?: PostgresCronSql;
  /** Injected Bun.SQL-compatible client. */
  readonly client?: BunCronClient;
}

/** Minimal Bun.SQL surface used by the real driver. */
export interface BunCronClient {
  unsafe(
    sql: string,
    values?: unknown[],
  ): PromiseLike<Record<string, unknown>[] | { length: number; changes?: number }>;
  begin<T>(fn: (tx: BunCronClient) => Promise<T> | T): Promise<T>;
  close?(options?: { timeout?: number }): Promise<void>;
}

function wrapBunClient(client: PostgresClientLike): PostgresCronSql {
  const api: PostgresCronSql = {
    async query(sql, params = []) {
      const pg = toPostgresParams(sql, params);
      const result = await client.unsafe(pg, [...params]);
      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return Array.from(result as ArrayLike<Record<string, unknown>>);
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
      if (Array.isArray(result)) return { changes: result.length };
      return { changes: 0 };
    },
    async begin(fn) {
      return withPinnedPostgres(client, (tx) => fn(wrapBunClient(tx)));
    },
    async close() {
      await client.close?.();
    },
  };
  return api;
}

function strOrUndef(v: unknown): string | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  return String(v);
}

function numOrUndef(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function rowToCron(row: Record<string, unknown>): CronRow {
  const dstRaw = row.dst_ambiguity;
  let dstAmbiguity: CronRow["dstAmbiguity"];
  if (typeof dstRaw === "string" && dstRaw.trim()) {
    dstAmbiguity = JSON.parse(dstRaw) as CronRow["dstAmbiguity"];
  }
  return {
    name: String(row.name),
    declaredCron: strOrUndef(row.declared_cron),
    declaredEvery: strOrUndef(row.declared_every),
    overrideCron: strOrUndef(row.override_cron),
    overrideEvery: strOrUndef(row.override_every),
    effectiveCron: strOrUndef(row.effective_cron),
    effectiveEvery: strOrUndef(row.effective_every),
    timezone: String(row.timezone ?? "UTC"),
    overridable: Boolean(row.overridable),
    status: String(row.status) as CronStatus,
    leaderInstanceId: strOrUndef(row.locked_by),
    leaderLeaseUntil: numOrUndef(row.lease_expires_at),
    lastRunAt: numOrUndef(row.last_run_at),
    nextRunAt: numOrUndef(row.next_run_at),
    dstAmbiguity,
  };
}

function cronToParams(row: CronRow): unknown[] {
  return [
    row.name,
    row.declaredCron ?? null,
    row.declaredEvery ?? null,
    row.overrideCron ?? null,
    row.overrideEvery ?? null,
    row.effectiveCron ?? null,
    row.effectiveEvery ?? null,
    row.timezone,
    row.overridable,
    row.status,
    row.leaderInstanceId ?? null,
    row.leaderLeaseUntil ?? null,
    row.lastRunAt ?? null,
    row.nextRunAt ?? null,
    row.dstAmbiguity ? JSON.stringify(row.dstAmbiguity) : null,
  ];
}

async function ensureSchema(sql: PostgresCronSql): Promise<void> {
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_crons (
    name TEXT PRIMARY KEY,
    declared_cron TEXT,
    declared_every TEXT,
    override_cron TEXT,
    override_every TEXT,
    effective_cron TEXT,
    effective_every TEXT,
    timezone TEXT NOT NULL,
    overridable BOOLEAN NOT NULL DEFAULT FALSE,
    status TEXT NOT NULL,
    locked_by TEXT,
    lease_expires_at BIGINT,
    last_run_at BIGINT,
    next_run_at BIGINT,
    dst_ambiguity TEXT
  )`);
}

/**
 * In-memory Postgres-protocol fake with transactions + SKIP LOCKED for tests.
 */
export function createPostgresCronFake(): PostgresCronSql & {
  /** Force-kill mid-transaction (drops uncommitted state). */
  killActiveTransaction(): void;
} {
  type State = { rows: CronDbRow[] };

  let committed: State = { rows: [] };
  let active: { state: State; locked: Set<string>; done: boolean } | null = null;
  /** Names held by other active transactions (SKIP LOCKED). */
  const heldByTxn = new Set<string>();
  /** Serialize top-level begins so concurrent acquires cannot join one txn. */
  let beginGate: Promise<void> = Promise.resolve();

  function view(): State {
    return active?.state ?? committed;
  }

  function cloneState(s: State): State {
    return { rows: s.rows.map((r) => ({ ...r })) };
  }

  const api: PostgresCronSql & { killActiveTransaction(): void } = {
    killActiveTransaction() {
      if (active) {
        for (const name of active.locked) heldByTxn.delete(name);
        active = null;
      }
    },
    async query(sql, params = []) {
      const text = sql.trim();
      const state = view();

      const isClaim = /FOR\s+UPDATE\s+SKIP\s+LOCKED/i.test(text) && /oke_crons/i.test(text);
      if (isClaim) {
        const name = String(params[0]);
        const holder = String(params[1]);
        const leaseCutoff = Number(params[2]);
        if (heldByTxn.has(name) && !(active?.locked.has(name) ?? false)) {
          return [];
        }
        const row = state.rows.find((r) => {
          if (r.name !== name) return false;
          const unlocked = r.locked_by === null;
          const renew = r.locked_by === holder;
          const expired = r.lease_expires_at !== null && r.lease_expires_at <= leaseCutoff;
          return unlocked || renew || expired;
        });
        if (!row) return [];
        if (active) {
          active.locked.add(name);
          heldByTxn.add(name);
        }
        return [{ ...row }];
      }

      const byName = /^SELECT\s+\*\s+FROM\s+oke_crons\s+WHERE\s+name\s*=\s*\?\s*$/i.exec(text);
      if (byName) {
        return state.rows.filter((r) => r.name === params[0]).map((r) => ({ ...r }));
      }

      const all = /^SELECT\s+\*\s+FROM\s+oke_crons\s*$/i.exec(text);
      if (all) {
        return state.rows.map((r) => ({ ...r }));
      }

      throw new Error(`postgres cron fake: unsupported query: ${sql}`);
    },
    async exec(sql, params = []) {
      const text = sql.trim();
      const state = view();

      if (/^CREATE\s+TABLE/i.test(text)) return { changes: 0 };

      const upsert =
        /^INSERT\s+INTO\s+oke_crons\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON\s+CONFLICT\s*\(\s*name\s*\)\s*DO\s+UPDATE\s+SET\s+.+$/i.exec(
          text,
        );
      if (upsert) {
        const cols = upsert[1]!.split(",").map((c) => c.trim());
        const record: Record<string, unknown> = {};
        cols.forEach((c, i) => {
          record[c] = params[i];
        });
        const next: CronDbRow = {
          name: String(record.name),
          declared_cron: (record.declared_cron as string | null) ?? null,
          declared_every: (record.declared_every as string | null) ?? null,
          override_cron: (record.override_cron as string | null) ?? null,
          override_every: (record.override_every as string | null) ?? null,
          effective_cron: (record.effective_cron as string | null) ?? null,
          effective_every: (record.effective_every as string | null) ?? null,
          timezone: String(record.timezone ?? "UTC"),
          overridable: Boolean(record.overridable),
          status: String(record.status),
          locked_by: (record.locked_by as string | null) ?? null,
          lease_expires_at:
            record.lease_expires_at === undefined || record.lease_expires_at === null
              ? null
              : Number(record.lease_expires_at),
          last_run_at:
            record.last_run_at === undefined || record.last_run_at === null
              ? null
              : Number(record.last_run_at),
          next_run_at:
            record.next_run_at === undefined || record.next_run_at === null
              ? null
              : Number(record.next_run_at),
          dst_ambiguity: (record.dst_ambiguity as string | null) ?? null,
        };
        const idx = state.rows.findIndex((r) => r.name === next.name);
        if (idx >= 0) state.rows[idx] = next;
        else state.rows.push(next);
        return { changes: 1 };
      }

      const updLease =
        /^UPDATE\s+oke_crons\s+SET\s+locked_by\s*=\s*\?,\s*lease_expires_at\s*=\s*\?\s+WHERE\s+name\s*=\s*\?\s*$/i.exec(
          text,
        );
      if (updLease) {
        const row = state.rows.find((r) => r.name === params[2]);
        if (!row) return { changes: 0 };
        row.locked_by = params[0] === null ? null : String(params[0]);
        row.lease_expires_at =
          params[1] === null || params[1] === undefined ? null : Number(params[1]);
        return { changes: 1 };
      }

      throw new Error(`postgres cron fake: unsupported exec: ${sql}`);
    },
    async begin(fn) {
      // Nested begin (same call stack) joins the open txn.
      if (active && !active.done) {
        return fn(api);
      }
      // Top-level begins serialize so Promise.all racing acquires stay exclusive.
      let release!: () => void;
      const slot = new Promise<void>((resolve) => {
        release = resolve;
      });
      const prev = beginGate;
      beginGate = slot;
      await prev;
      active = { state: cloneState(committed), locked: new Set(), done: false };
      try {
        const result = await fn(api);
        if (active) {
          for (const name of active.locked) heldByTxn.delete(name);
          committed = active.state;
          active.done = true;
          active = null;
        }
        return result;
      } catch (err) {
        if (active) {
          for (const name of active.locked) heldByTxn.delete(name);
        }
        active = null;
        throw err;
      } finally {
        release();
      }
    },
    async close() {
      active = null;
      heldByTxn.clear();
    },
  };

  return api;
}

const UPSERT_SQL = `INSERT INTO oke_crons (name, declared_cron, declared_every, override_cron, override_every, effective_cron, effective_every, timezone, overridable, status, locked_by, lease_expires_at, last_run_at, next_run_at, dst_ambiguity) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (name) DO UPDATE SET declared_cron = EXCLUDED.declared_cron, declared_every = EXCLUDED.declared_every, override_cron = EXCLUDED.override_cron, override_every = EXCLUDED.override_every, effective_cron = EXCLUDED.effective_cron, effective_every = EXCLUDED.effective_every, timezone = EXCLUDED.timezone, overridable = EXCLUDED.overridable, status = EXCLUDED.status, locked_by = EXCLUDED.locked_by, lease_expires_at = EXCLUDED.lease_expires_at, last_run_at = EXCLUDED.last_run_at, next_run_at = EXCLUDED.next_run_at, dst_ambiguity = EXCLUDED.dst_ambiguity`;

/**
 * Open a postgres-backed CronStore (multi-host leader election).
 *
 * @param options - URL / injected sql / Bun.SQL client
 */
export async function createPostgresCronStore(
  options: CreatePostgresCronStoreOptions = {},
): Promise<CronStore & { readonly sql: PostgresCronSql; close(): Promise<void> }> {
  const sql =
    options.sql ??
    wrapBunClient(
      (options.client ??
        sharedPostgresClient(resolvePostgresUrl(options.url))) as PostgresClientLike,
    );

  await ensureSchema(sql);

  const store: CronStore & { readonly sql: PostgresCronSql; close(): Promise<void> } = {
    kind: "postgres",
    sql,
    async get(name) {
      const rows = await sql.query(`SELECT * FROM oke_crons WHERE name = ?`, [name]);
      if (!rows[0]) return undefined;
      return rowToCron(rows[0]);
    },
    async put(row) {
      await sql.exec(UPSERT_SQL, cronToParams(row));
    },
    async list() {
      const rows = await sql.query(`SELECT * FROM oke_crons`);
      return rows.map((r) => rowToCron(r));
    },
    async acquireLease(name, instanceId, now, leaseMs) {
      return sql.begin(async (tx) => {
        const claimed = await tx.query(CLAIM_LEASE_SQL, [name, instanceId, now]);
        if (!claimed[0]) return false;
        const until = now + leaseMs;
        await tx.exec(`UPDATE oke_crons SET locked_by = ?, lease_expires_at = ? WHERE name = ?`, [
          instanceId,
          until,
          name,
        ]);
        return true;
      });
    },
    async close() {
      await sql.close();
    },
  };

  return store;
}
