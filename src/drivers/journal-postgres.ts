/**
 * `postgres` journal driver — shared durable-run store via SKIP LOCKED + lease reclaim.
 *
 * Same concurrency physics as Signal's `once` delivery and Clock's postgres
 * CronStore: claim with `FOR UPDATE SKIP LOCKED`; a crashed holder's lease is
 * reclaimed lazily on the next claim attempt (no sweeper, no fencing token —
 * completed journal steps replay instead of re-running).
 */

import {
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalEntry,
  type JournalLeaseStore,
  type JournalRun,
  type JournalStore,
} from "../kernel/journal.ts";
import {
  resolvePostgresUrl,
  sharedPostgresClient,
  toPostgresParams,
  withPinnedPostgres,
  type PostgresClientLike,
} from "./postgres.ts";

/** Row shape in `oke_journal_runs` (lease columns mirror `oke_crons`). */
interface JournalDbRow {
  id: string;
  flow: string;
  input: string | null;
  status: string;
  entries: string;
  wake_at: number | null;
  error: string | null;
  output: string | null;
  locked_by: string | null;
  lease_expires_at: number | null;
  created_at: number;
  updated_at: number;
}

/** Minimal SQL + transaction surface for the postgres journal store. */
export interface PostgresJournalSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  /**
   * Run `fn` inside a transaction. Nested calls join the outer txn.
   *
   * @param fn - Body
   */
  begin<T>(fn: (sql: PostgresJournalSql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

/**
 * Claim a run for lease acquire / renew / reclaim.
 *
 * Claimable when unlocked, same holder renewing, or lease expired
 * (lazy reclaim — matches the cron lease predicate).
 */
const CLAIM_LEASE_SQL = `SELECT * FROM oke_journal_runs WHERE id=? AND ((locked_by IS NULL) OR (locked_by=?) OR (lease_expires_at IS NOT NULL AND lease_expires_at<=?)) FOR UPDATE SKIP LOCKED`;

/**
 * Claim the next due sleep — Signal-shaped queue drain: `sleeping`, wake time
 * reached, no live lease; oldest wake first.
 */
const CLAIM_DUE_SQL = `SELECT * FROM oke_journal_runs WHERE status='sleeping' AND wake_at<=? AND ((locked_by IS NULL) OR (lease_expires_at IS NOT NULL AND lease_expires_at<=?)) ORDER BY wake_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;

/** Boot-time orphan discovery: running/sleeping runs with no live lease. */
const ORPHANS_SQL = `SELECT * FROM oke_journal_runs WHERE (status='running' OR status='sleeping' OR status='compensating') AND ((locked_by IS NULL) OR (lease_expires_at IS NOT NULL AND lease_expires_at<=?))`;

const UPDATE_LEASE_SQL = `UPDATE oke_journal_runs SET locked_by = ?, lease_expires_at = ? WHERE id = ?`;

/** Guarded release — never clears another holder's lease. */
const RELEASE_LEASE_SQL = `UPDATE oke_journal_runs SET locked_by = NULL, lease_expires_at = NULL WHERE id = ? AND locked_by = ?`;

/** Options for {@link createPostgresJournalStore}. */
export interface CreatePostgresJournalStoreOptions {
  /** Postgres connection URL (Bun.SQL). Ignored when `sql` is injected. */
  readonly url?: string;
  /** Injected SQL surface (tests / fakes). */
  readonly sql?: PostgresJournalSql;
  /** Injected Bun.SQL-compatible client. */
  readonly client?: BunJournalClient;
}

/** Minimal Bun.SQL surface used by the real driver. */
export interface BunJournalClient {
  unsafe(
    sql: string,
    values?: unknown[],
  ): PromiseLike<Record<string, unknown>[] | { length: number; changes?: number }>;
  begin<T>(fn: (tx: BunJournalClient) => Promise<T> | T): Promise<T>;
  close?(options?: { timeout?: number }): Promise<void>;
}

function wrapBunClient(client: PostgresClientLike): PostgresJournalSql {
  const api: PostgresJournalSql = {
    async query(sql, params = []) {
      const pg = toPostgresParams(sql);
      const result = await client.unsafe(pg, [...params]);
      if (Array.isArray(result)) return result as Record<string, unknown>[];
      return Array.from(result as ArrayLike<Record<string, unknown>>);
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

function numOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function rowToRun(row: Record<string, unknown>): JournalRun {
  const r = row as unknown as JournalDbRow;
  const run: JournalRun = {
    id: String(r.id),
    flow: String(r.flow),
    input: r.input === null ? undefined : (JSON.parse(r.input) as unknown),
    status: String(r.status) as JournalRun["status"],
    entries: JSON.parse(r.entries) as JournalEntry[],
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
  };
  const wakeAt = numOrNull(r.wake_at);
  if (wakeAt !== null) run.wakeAt = wakeAt;
  if (r.error !== null && r.error !== undefined) run.error = String(r.error);
  if (r.output !== null && r.output !== undefined) {
    run.output = JSON.parse(String(r.output)) as unknown;
  }
  if (r.locked_by !== null && r.locked_by !== undefined) run.lockedBy = String(r.locked_by);
  const leaseExpiresAt = numOrNull(r.lease_expires_at);
  if (leaseExpiresAt !== null) run.leaseExpiresAt = leaseExpiresAt;
  return run;
}

function runToParams(run: JournalRun): unknown[] {
  return [
    run.id,
    run.flow,
    run.input === undefined ? null : JSON.stringify(run.input),
    run.status,
    JSON.stringify(run.entries),
    run.wakeAt ?? null,
    run.error ?? null,
    run.output === undefined ? null : JSON.stringify(run.output),
    run.lockedBy ?? null,
    run.leaseExpiresAt ?? null,
    run.createdAt,
    run.updatedAt,
  ];
}

async function ensureSchema(sql: PostgresJournalSql): Promise<void> {
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_journal_runs (
    id TEXT PRIMARY KEY,
    flow TEXT NOT NULL,
    input TEXT,
    status TEXT NOT NULL,
    entries TEXT NOT NULL,
    wake_at BIGINT,
    error TEXT,
    output TEXT,
    locked_by TEXT,
    lease_expires_at BIGINT,
    created_at BIGINT NOT NULL,
    updated_at BIGINT NOT NULL
  )`);
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS oke_journal_runs_wake ON oke_journal_runs (status, wake_at)`,
  );
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS oke_journal_runs_lease ON oke_journal_runs (status, lease_expires_at)`,
  );
}

/**
 * In-memory Postgres-protocol fake with transactions + SKIP LOCKED for tests.
 */
export function createPostgresJournalFake(): PostgresJournalSql & {
  /** Force-kill mid-transaction (drops uncommitted state). */
  killActiveTransaction(): void;
} {
  type State = { rows: JournalDbRow[] };

  let committed: State = { rows: [] };
  let active: { state: State; locked: Set<string>; done: boolean } | null = null;
  /** Run ids held by other active transactions (SKIP LOCKED). */
  const heldByTxn = new Set<string>();
  /** Serialize top-level begins so concurrent acquires cannot join one txn. */
  let beginGate: Promise<void> = Promise.resolve();

  function view(): State {
    return active?.state ?? committed;
  }

  function cloneState(s: State): State {
    return { rows: s.rows.map((r) => ({ ...r })) };
  }

  function claimable(r: JournalDbRow, holder: string, cutoff: number): boolean {
    if (r.locked_by === null) return true;
    if (r.locked_by === holder) return true;
    return r.lease_expires_at !== null && r.lease_expires_at <= cutoff;
  }

  function noLiveLease(r: JournalDbRow, cutoff: number): boolean {
    return r.locked_by === null || (r.lease_expires_at !== null && r.lease_expires_at <= cutoff);
  }

  function tryLock(id: string): boolean {
    if (heldByTxn.has(id) && !(active?.locked.has(id) ?? false)) return false;
    if (active) {
      active.locked.add(id);
      heldByTxn.add(id);
    }
    return true;
  }

  const api: PostgresJournalSql & { killActiveTransaction(): void } = {
    killActiveTransaction() {
      if (active) {
        for (const id of active.locked) heldByTxn.delete(id);
        active = null;
      }
    },
    async query(sql, params = []) {
      const text = sql.trim();
      const state = view();

      const isClaim = /FOR\s+UPDATE\s+SKIP\s+LOCKED/i.test(text) && /oke_journal_runs/i.test(text);
      if (isClaim) {
        const isDue = /status\s*=\s*'sleeping'/i.test(text) && /wake_at\s*<=/i.test(text);
        if (isDue) {
          const wakeCutoff = Number(params[0]);
          const leaseCutoff = Number(params[1]);
          const row = state.rows
            .filter(
              (r) =>
                r.status === "sleeping" &&
                r.wake_at !== null &&
                r.wake_at <= wakeCutoff &&
                noLiveLease(r, leaseCutoff),
            )
            .sort((a, b) => (a.wake_at ?? 0) - (b.wake_at ?? 0))
            .find((r) => tryLock(r.id));
          return row ? [{ ...row }] : [];
        }
        const id = String(params[0]);
        const holder = String(params[1]);
        const leaseCutoff = Number(params[2]);
        if (heldByTxn.has(id) && !(active?.locked.has(id) ?? false)) {
          return [];
        }
        const row = state.rows.find((r) => r.id === id && claimable(r, holder, leaseCutoff));
        if (!row) return [];
        tryLock(id);
        return [{ ...row }];
      }

      const byId = /^SELECT\s+\*\s+FROM\s+oke_journal_runs\s+WHERE\s+id\s*=\s*\?\s*$/i.exec(text);
      if (byId) {
        return state.rows.filter((r) => r.id === params[0]).map((r) => ({ ...r }));
      }

      const orphans =
        /status\s*=\s*'running'\s+OR\s+status\s*=\s*'sleeping'/i.test(text) &&
        !/FOR\s+UPDATE/i.test(text);
      if (orphans) {
        const cutoff = Number(params[0]);
        return state.rows
          .filter(
            (r) =>
              (r.status === "running" || r.status === "sleeping" || r.status === "compensating") &&
              noLiveLease(r, cutoff),
          )
          .map((r) => ({ ...r }));
      }

      const all = /^SELECT\s+\*\s+FROM\s+oke_journal_runs\s*$/i.exec(text);
      if (all) {
        return state.rows.map((r) => ({ ...r }));
      }

      throw new Error(`postgres journal fake: unsupported query: ${sql}`);
    },
    async exec(sql, params = []) {
      const text = sql.trim();
      const state = view();

      if (/^CREATE\s+(TABLE|INDEX)/i.test(text)) return { changes: 0 };

      const upsert =
        /^INSERT\s+INTO\s+oke_journal_runs\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*ON\s+CONFLICT\s*\(\s*id\s*\)\s*DO\s+UPDATE\s+SET\s+.+$/i.exec(
          text,
        );
      if (upsert) {
        const cols = upsert[1]!.split(",").map((c) => c.trim());
        const record: Record<string, unknown> = {};
        cols.forEach((c, i) => {
          record[c] = params[i];
        });
        const next: JournalDbRow = {
          id: String(record.id),
          flow: String(record.flow),
          input: (record.input as string | null) ?? null,
          status: String(record.status),
          entries: String(record.entries ?? "[]"),
          wake_at:
            record.wake_at === undefined || record.wake_at === null ? null : Number(record.wake_at),
          error: (record.error as string | null) ?? null,
          output: (record.output as string | null) ?? null,
          locked_by: (record.locked_by as string | null) ?? null,
          lease_expires_at:
            record.lease_expires_at === undefined || record.lease_expires_at === null
              ? null
              : Number(record.lease_expires_at),
          created_at: Number(record.created_at ?? 0),
          updated_at: Number(record.updated_at ?? 0),
        };
        const idx = state.rows.findIndex((r) => r.id === next.id);
        if (idx >= 0) state.rows[idx] = next;
        else state.rows.push(next);
        return { changes: 1 };
      }

      const updLease =
        /^UPDATE\s+oke_journal_runs\s+SET\s+locked_by\s*=\s*\?,\s*lease_expires_at\s*=\s*\?\s+WHERE\s+id\s*=\s*\?\s*$/i.exec(
          text,
        );
      if (updLease) {
        const row = state.rows.find((r) => r.id === params[2]);
        if (!row) return { changes: 0 };
        row.locked_by = params[0] === null ? null : String(params[0]);
        row.lease_expires_at =
          params[1] === null || params[1] === undefined ? null : Number(params[1]);
        return { changes: 1 };
      }

      const release =
        /^UPDATE\s+oke_journal_runs\s+SET\s+locked_by\s*=\s*NULL,\s*lease_expires_at\s*=\s*NULL\s+WHERE\s+id\s*=\s*\?\s+AND\s+locked_by\s*=\s*\?\s*$/i.exec(
          text,
        );
      if (release) {
        const row = state.rows.find((r) => r.id === params[0]);
        if (!row || row.locked_by !== String(params[1])) return { changes: 0 };
        row.locked_by = null;
        row.lease_expires_at = null;
        return { changes: 1 };
      }

      const del = /^DELETE\s+FROM\s+oke_journal_runs\s+WHERE\s+id\s*=\s*\?\s*$/i.exec(text);
      if (del) {
        const idx = state.rows.findIndex((r) => r.id === params[0]);
        if (idx >= 0) {
          state.rows.splice(idx, 1);
          return { changes: 1 };
        }
        return { changes: 0 };
      }

      throw new Error(`postgres journal fake: unsupported exec: ${sql}`);
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
          for (const id of active.locked) heldByTxn.delete(id);
          committed = active.state;
          active.done = true;
          active = null;
        }
        return result;
      } catch (err) {
        if (active) {
          for (const id of active.locked) heldByTxn.delete(id);
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

const UPSERT_SQL = `INSERT INTO oke_journal_runs (id, flow, input, status, entries, wake_at, error, output, locked_by, lease_expires_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET flow = EXCLUDED.flow, input = EXCLUDED.input, status = EXCLUDED.status, entries = EXCLUDED.entries, wake_at = EXCLUDED.wake_at, error = EXCLUDED.error, output = EXCLUDED.output, locked_by = EXCLUDED.locked_by, lease_expires_at = EXCLUDED.lease_expires_at, created_at = EXCLUDED.created_at, updated_at = EXCLUDED.updated_at`;

/** Postgres journal store with run-level lease coordination. */
export type PostgresJournalStore = JournalStore &
  JournalLeaseStore & {
    readonly sql: PostgresJournalSql;
    close(): Promise<void>;
  };

/**
 * Open a postgres-backed JournalStore (multi-host durable-run coordination).
 *
 * @param options - URL / injected sql / Bun.SQL client
 */
export async function createPostgresJournalStore(
  options: CreatePostgresJournalStoreOptions = {},
): Promise<PostgresJournalStore> {
  const sql =
    options.sql ??
    wrapBunClient(
      (options.client ??
        sharedPostgresClient(resolvePostgresUrl(options.url))) as PostgresClientLike,
    );

  await ensureSchema(sql);

  const store: PostgresJournalStore = {
    sql,
    async get(runId) {
      const rows = await sql.query(`SELECT * FROM oke_journal_runs WHERE id = ?`, [runId]);
      if (!rows[0]) return undefined;
      return rowToRun(rows[0]);
    },
    async put(run) {
      await sql.exec(UPSERT_SQL, runToParams(run));
    },
    async list() {
      const rows = await sql.query(`SELECT * FROM oke_journal_runs`);
      return rows.map((r) => rowToRun(r));
    },
    async acquireLease(runId, instanceId, now, leaseMs) {
      return sql.begin(async (tx) => {
        const claimed = await tx.query(CLAIM_LEASE_SQL, [runId, instanceId, now]);
        if (!claimed[0]) return false;
        await tx.exec(UPDATE_LEASE_SQL, [instanceId, now + leaseMs, runId]);
        return true;
      });
    },
    async releaseLease(runId, instanceId) {
      await sql.exec(RELEASE_LEASE_SQL, [runId, instanceId]);
    },
    async claimDueSleep(instanceId, now, leaseMs) {
      return sql.begin(async (tx) => {
        const rows = await tx.query(CLAIM_DUE_SQL, [now, now]);
        const row = rows[0];
        if (!row) return undefined;
        await tx.exec(UPDATE_LEASE_SQL, [instanceId, now + leaseMs, String(row.id)]);
        return rowToRun(row);
      });
    },
    async listOrphans(now) {
      const rows = await sql.query(ORPHANS_SQL, [now]);
      return rows.map((r) => rowToRun(r));
    },
    async close() {
      await sql.close();
    },
  };

  return store;
}

export { JOURNAL_DEFAULT_LEASE_MS };
