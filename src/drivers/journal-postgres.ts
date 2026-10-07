/**
 * `postgres` journal driver — shared durable-run store via SKIP LOCKED + lease reclaim.
 *
 * Same concurrency physics as Signal's `once` delivery and Clock's postgres
 * CronStore: claim with `FOR UPDATE SKIP LOCKED`; a crashed holder's lease is
 * reclaimed lazily on the next claim attempt (no sweeper). Each acquire bumps
 * a fencing token; writes from a previous holder are rejected. Entries are
 * append-only rows, not a rewritten JSON blob.
 */

import {
  createPostgresIdempotencyStore,
  IDEM_ATTACH_SQL,
  IDEM_COMPLETE_SQL,
  IDEM_DELETE_EXPIRED_ONE_SQL,
  IDEM_FORFEIT_SQL,
  IDEM_INSERT_SQL,
  IDEM_PURGE_SQL,
  IDEM_RECLAIM_SQL,
  IDEM_REMOVE_SQL,
  IDEM_RENEW_SQL,
  IDEM_SELECT_SQL,
} from "../kernel/idempotency-store.ts";
import type { DecisionLabelStore } from "../kernel/decision-label-store.ts";
import type { AgentEventStore } from "../kernel/agent-event-store.ts";
import { throwOke } from "../kernel/errors.ts";
import { lazyRequire } from "../kernel/lazy-require.ts";
import {
  JOURNAL_DEFAULT_LEASE_MS,
  type JournalEntry,
  type JournalLeaseStore,
  type JournalRun,
  type JournalStore,
  type JournalWriteFence,
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
  tenant: string | null;
  lease_token: number | null;
  code_version: string | null;
}

/** One append-only journal entry row. */
interface JournalEntryDbRow {
  run_id: string;
  seq: number;
  kind: string;
  name: string | null;
  resource: string | null;
  value: string | null;
  at: number;
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

const UPDATE_LEASE_SQL = `UPDATE oke_journal_runs SET locked_by = ?, lease_expires_at = ?, lease_token = COALESCE(lease_token, 0) + 1 WHERE id = ?`;

const HEARTBEAT_SQL = `UPDATE oke_journal_runs SET lease_expires_at = GREATEST(COALESCE(lease_expires_at, 0), ?) WHERE id = ? AND locked_by = ? AND lease_token = ? AND lease_expires_at > ?`;

const INSERT_ENTRY_SQL = `INSERT INTO oke_journal_entries (run_id, seq, kind, name, resource, value, at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (run_id, seq) DO NOTHING`;

/** One entry row, inserted only while the caller's fence still holds. */
const APPEND_ENTRY_FENCED_SQL = `INSERT INTO oke_journal_entries (run_id, seq, kind, name, resource, value, at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM oke_journal_runs WHERE id = ? AND locked_by = ? AND lease_token = ? AND lease_expires_at > ? FOR SHARE) ON CONFLICT (run_id, seq) DO NOTHING`;

const UPDATE_ENTRY_FENCED_SQL = `UPDATE oke_journal_entries SET kind = ?, name = ?, resource = ?, value = ?, at = ? WHERE run_id = ? AND seq = ? AND EXISTS (SELECT 1 FROM oke_journal_runs WHERE id = ? AND locked_by = ? AND lease_token = ? AND lease_expires_at > ? FOR SHARE)`;

const FENCED_HEADER_SQL = `UPDATE oke_journal_runs SET flow = ?, input = ?, status = ?, entries = ?, wake_at = ?, error = ?, output = ?, locked_by = ?, lease_expires_at = ?, updated_at = ?, tenant = ?, lease_token = GREATEST(COALESCE(lease_token, 0), ?), code_version = ? WHERE id = ? AND locked_by = ? AND lease_token = ? AND lease_expires_at > ?`;

/** Header write inside `cas`, which already holds the row `FOR UPDATE`. */
const CAS_HEADER_SQL = `UPDATE oke_journal_runs SET flow = ?, input = ?, status = ?, entries = ?, wake_at = ?, error = ?, output = ?, locked_by = ?, lease_expires_at = ?, updated_at = ?, tenant = ?, lease_token = GREATEST(COALESCE(lease_token, 0), ?), code_version = ? WHERE id = ? AND COALESCE(lease_token, 0) = ?`;

/**
 * Every statement the journal driver sends. The in-memory fake must match
 * each one; a new statement that misses every branch fails the driver tests.
 */
export function postgresJournalStatements(): readonly string[] {
  return [
    CLAIM_LEASE_SQL,
    CLAIM_DUE_SQL,
    ORPHANS_SQL,
    UPDATE_LEASE_SQL,
    HEARTBEAT_SQL,
    INSERT_ENTRY_SQL,
    APPEND_ENTRY_FENCED_SQL,
    UPDATE_ENTRY_FENCED_SQL,
    FENCED_HEADER_SQL,
    CAS_HEADER_SQL,
    SELECT_ENTRIES_SQL,
    RELEASE_LEASE_SQL,
    UPSERT_SQL,
  ];
}

const SELECT_ENTRIES_SQL = `SELECT * FROM oke_journal_entries WHERE run_id = ? ORDER BY seq ASC`;

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
  if (r.tenant !== null && r.tenant !== undefined && String(r.tenant).length > 0) {
    run.tenant = String(r.tenant);
  }
  const leaseToken = numOrNull(r.lease_token);
  if (leaseToken !== null) run.leaseToken = leaseToken;
  if (
    r.code_version !== null &&
    r.code_version !== undefined &&
    String(r.code_version).length > 0
  ) {
    run.codeVersion = String(r.code_version);
  }
  return run;
}

function sameEntry(a: JournalEntry, b: JournalEntry): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function fencedHeaderParams(run: JournalRun, fence: JournalWriteFence): unknown[] {
  const base = runToParams(run);
  return [
    base[1],
    base[2],
    base[3],
    JSON.stringify([]),
    base[5],
    base[6],
    base[7],
    base[8],
    base[9],
    base[11],
    base[12],
    fence.leaseToken,
    base[14],
    run.id,
    fence.lockedBy,
    fence.leaseToken,
    fence.now,
  ];
}

function casHeaderParams(run: JournalRun, heldToken: number): unknown[] {
  const base = runToParams(run);
  return [
    base[1],
    base[2],
    base[3],
    JSON.stringify([]),
    base[5],
    base[6],
    base[7],
    base[8],
    base[9],
    base[11],
    base[12],
    run.leaseToken ?? heldToken,
    base[14],
    run.id,
    heldToken,
  ];
}

function entryToParams(runId: string, seq: number, entry: JournalEntry): unknown[] {
  if (entry.kind === "step") {
    return [runId, seq, "step", entry.name, null, JSON.stringify(entry.value ?? null), entry.at];
  }
  if (entry.kind === "sleep") {
    return [
      runId,
      seq,
      "sleep",
      entry.label,
      entry.duration,
      JSON.stringify(entry.wakeAt),
      entry.at,
    ];
  }
  return [
    runId,
    seq,
    "effect",
    entry.effectKind,
    entry.resource,
    JSON.stringify(entry.value ?? null),
    entry.at,
  ];
}

function entryFromRow(row: Record<string, unknown>): JournalEntry {
  const kind = String(row.kind);
  const at = Number(row.at);
  const value =
    row.value === null || row.value === undefined ? null : JSON.parse(String(row.value));
  if (kind === "step") {
    return { kind: "step", name: String(row.name ?? ""), value, at };
  }
  if (kind === "sleep") {
    return {
      kind: "sleep",
      label: String(row.name ?? ""),
      duration: String(row.resource ?? ""),
      wakeAt: Number(value),
      at,
    };
  }
  return {
    kind: "effect",
    effectKind: String(row.name ?? ""),
    resource: String(row.resource ?? ""),
    value,
    at,
  };
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
    run.tenant ?? null,
    run.leaseToken ?? null,
    run.codeVersion ?? null,
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
    updated_at BIGINT NOT NULL,
    tenant TEXT
  )`);
  await sql.exec(`ALTER TABLE oke_journal_runs ADD COLUMN IF NOT EXISTS tenant TEXT`);
  await sql.exec(`ALTER TABLE oke_journal_runs ADD COLUMN IF NOT EXISTS lease_token BIGINT`);
  await sql.exec(`ALTER TABLE oke_journal_runs ADD COLUMN IF NOT EXISTS code_version TEXT`);
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_journal_entries (
    run_id TEXT NOT NULL,
    seq BIGINT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT,
    resource TEXT,
    value TEXT,
    at BIGINT NOT NULL,
    PRIMARY KEY (run_id, seq)
  )`);
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS oke_journal_runs_wake ON oke_journal_runs (status, wake_at)`,
  );
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS oke_journal_runs_lease ON oke_journal_runs (status, lease_expires_at)`,
  );
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_idempotency (
    tenant TEXT NOT NULL DEFAULT '',
    principal TEXT NOT NULL,
    flow TEXT NOT NULL,
    key TEXT NOT NULL,
    fingerprint TEXT NOT NULL,
    status TEXT NOT NULL,
    claim_token TEXT NOT NULL,
    lease_expires_at BIGINT NOT NULL,
    run_id TEXT,
    response_status INTEGER,
    response_headers TEXT,
    response_body TEXT,
    created_at BIGINT NOT NULL,
    expires_at BIGINT NOT NULL,
    PRIMARY KEY (tenant, principal, flow, key)
  )`);
  await sql.exec(
    `CREATE INDEX IF NOT EXISTS oke_idempotency_expires ON oke_idempotency (expires_at)`,
  );
}

/**
 * In-memory Postgres-protocol fake with transactions + SKIP LOCKED for tests.
 */
export function createPostgresJournalFake(): PostgresJournalSql & {
  /** Force-kill mid-transaction (drops uncommitted state). */
  killActiveTransaction(): void;
} {
  type IdemDbRow = {
    tenant: string;
    principal: string;
    flow: string;
    key: string;
    fingerprint: string;
    status: string;
    claim_token: string;
    lease_expires_at: number;
    run_id: string | null;
    response_status: number | null;
    response_headers: string | null;
    response_body: string | null;
    created_at: number;
    expires_at: number;
  };
  type LabelDbRow = {
    decision_id: string;
    question: string;
    value: string;
    propensity: number;
    reviewer: string;
    locale: string | null;
    model: string | null;
    tenant: string | null;
    score: number | null;
    loss: number | null;
    raw: string | null;
    at: number;
    input: string | null;
    review_id?: string | null;
  };
  type State = {
    rows: JournalDbRow[];
    idem: IdemDbRow[];
    labels: LabelDbRow[];
    drift: { decision_id: string; suspended: number; certified_at: number }[];
    candidates: { decision_id: string; body: string }[];
    agentRuns: { run_id: string; header: string; sweep_claim_at: number | null }[];
    agentEvents: {
      run_id: string;
      seq: number;
      event: string;
      event_type: string | null;
      event_name: string | null;
    }[];
    entries: JournalEntryDbRow[];
  };

  let committed: State = {
    rows: [],
    idem: [],
    labels: [],
    drift: [],
    candidates: [],
    agentRuns: [],
    agentEvents: [],
    entries: [],
  };
  let active: { state: State; locked: Set<string>; done: boolean } | null = null;
  /** Run ids held by other active transactions (SKIP LOCKED). */
  const heldByTxn = new Set<string>();
  /** Serialize top-level begins so concurrent acquires cannot join one txn. */
  let beginGate: Promise<void> = Promise.resolve();

  function view(): State {
    return active?.state ?? committed;
  }

  function cloneState(s: State): State {
    return {
      rows: s.rows.map((r) => ({ ...r })),
      idem: s.idem.map((r) => ({ ...r })),
      labels: s.labels.map((r) => ({ ...r })),
      drift: s.drift.map((r) => ({ ...r })),
      candidates: s.candidates.map((r) => ({ ...r })),
      agentRuns: s.agentRuns.map((r) => ({ ...r })),
      agentEvents: s.agentEvents.map((r) => ({ ...r })),
      entries: s.entries.map((r) => ({ ...r })),
    };
  }

  function idemPk(row: IdemDbRow, params: readonly unknown[], offset = 0): boolean {
    return (
      row.tenant === String(params[offset]) &&
      row.principal === String(params[offset + 1]) &&
      row.flow === String(params[offset + 2]) &&
      row.key === String(params[offset + 3])
    );
  }

  function claimable(r: JournalDbRow, holder: string, cutoff: number): boolean {
    if (r.locked_by === null) return true;
    if (r.locked_by === holder) return true;
    return r.lease_expires_at !== null && r.lease_expires_at <= cutoff;
  }

  function noLiveLease(r: JournalDbRow, cutoff: number): boolean {
    return r.locked_by === null || (r.lease_expires_at !== null && r.lease_expires_at <= cutoff);
  }

  function fenceHolds(
    state: { rows: JournalDbRow[] },
    id: string,
    lockedBy: string,
    token: number,
    now: number,
  ): boolean {
    const row = state.rows.find((r) => r.id === id);
    if (!row || row.locked_by !== lockedBy) return false;
    if ((row.lease_token ?? 0) !== token) return false;
    return row.lease_expires_at !== null && row.lease_expires_at > now;
  }

  function applyFencedHeader(
    state: { rows: JournalDbRow[] },
    text: string,
    params: readonly unknown[],
  ): { changes: number } {
    const tokenOnly = /COALESCE\(lease_token,\s*0\)\s*=\s*\?/i.test(text);
    const id = String(params[13]);
    const row = state.rows.find((r) => r.id === id);
    if (!row) return { changes: 0 };
    if (tokenOnly) {
      if ((row.lease_token ?? 0) !== Number(params[14])) return { changes: 0 };
    } else if (!fenceHolds(state, id, String(params[14]), Number(params[15]), Number(params[16]))) {
      return { changes: 0 };
    }
    row.flow = String(params[0]);
    row.input = params[1] === null || params[1] === undefined ? null : String(params[1]);
    row.status = String(params[2]);
    row.entries = String(params[3] ?? "[]");
    row.wake_at = params[4] === null || params[4] === undefined ? null : Number(params[4]);
    row.error = params[5] === null || params[5] === undefined ? null : String(params[5]);
    row.output = params[6] === null || params[6] === undefined ? null : String(params[6]);
    row.locked_by = params[7] === null || params[7] === undefined ? null : String(params[7]);
    row.lease_expires_at = params[8] === null || params[8] === undefined ? null : Number(params[8]);
    row.updated_at = Number(params[9] ?? 0);
    row.tenant = params[10] === null || params[10] === undefined ? null : String(params[10]);
    row.lease_token = Math.max(row.lease_token ?? 0, Number(params[11] ?? 0));
    row.code_version =
      params[12] === null || params[12] === undefined ? row.code_version : String(params[12]);
    return { changes: 1 };
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

      if (text === IDEM_SELECT_SQL) {
        return state.idem
          .filter((row) => idemPk(row, params))
          .map((row) => ({ ...row }) as Record<string, unknown>);
      }

      if (/FROM\s+oke_decision_labels/i.test(text)) {
        let labels = state.labels;
        let arg = 0;
        if (/decision_id\s*=\s*\?/i.test(text)) {
          const id = String(params[arg++] ?? "");
          labels = labels.filter((row) => row.decision_id === id);
        }
        if (/tenant\s+IS\s+NOT\s+DISTINCT\s+FROM\s+\?/i.test(text)) {
          const tenant = params[arg] ?? null;
          labels = labels.filter((row) => row.tenant === tenant);
        }
        return labels.map((row) => ({ ...row }));
      }

      if (/FROM\s+oke_decision_drift/i.test(text)) {
        return state.drift.map((row) => ({ ...row }));
      }

      if (/FROM\s+oke_decision_candidates/i.test(text)) {
        if (/decision_id\s*=\s*\?/i.test(text)) {
          const id = String(params[0] ?? "");
          return state.candidates
            .filter((row) => row.decision_id === id)
            .map((row) => ({ ...row }));
        }
        return state.candidates.map((row) => ({ ...row }));
      }

      if (/FROM\s+oke_agent_run\b/i.test(text)) {
        if (!/WHERE/i.test(text)) return state.agentRuns.map((row) => ({ ...row }));
        const id = String(params[0] ?? "");
        return state.agentRuns.filter((row) => row.run_id === id).map((row) => ({ ...row }));
      }

      if (/FROM\s+oke_agent_event\b/i.test(text)) {
        const id = String(params[0] ?? "");
        if (/MAX\s*\(\s*seq\s*\)/i.test(text)) {
          const max = state.agentEvents
            .filter((row) => row.run_id === id)
            .reduce((highest, row) => Math.max(highest, row.seq), 0);
          return [{ max_seq: max }];
        }
        if (/event_type\s*=/i.test(text)) {
          const eventType = String(params[1] ?? "");
          const eventName = String(params[2] ?? "");
          return state.agentEvents
            .filter(
              (row) =>
                row.run_id === id && row.event_type === eventType && row.event_name === eventName,
            )
            .map((row) => ({ ...row }));
        }
        const after = /seq\s*>\s*\?/i.test(text) ? Number(params[1] ?? 0) : 0;
        return state.agentEvents
          .filter((row) => row.run_id === id && row.seq > after)
          .sort((a, b) => a.seq - b.seq)
          .map((row) => ({ ...row }));
      }

      if (/FROM\s+oke_journal_entries/i.test(text)) {
        const runId = String(params[0] ?? "");
        const seq = /seq\s*=\s*\?/i.test(text) ? Number(params[1]) : undefined;
        return state.entries
          .filter((row) => row.run_id === runId && (seq === undefined || row.seq === seq))
          .sort((a, b) => a.seq - b.seq)
          .map((row) => ({ ...row }));
      }

      throw new Error(`postgres journal fake: unsupported query: ${sql}`);
    },
    async exec(sql, params = []) {
      const text = sql.trim();
      const state = view();

      if (/^CREATE\s+(TABLE|INDEX)/i.test(text) || /^ALTER\s+TABLE/i.test(text))
        return { changes: 0 };

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
          tenant: (record.tenant as string | null) ?? null,
          lease_token: (() => {
            const prev = state.rows.find((r) => r.id === String(record.id))?.lease_token ?? 0;
            const incoming =
              record.lease_token === undefined || record.lease_token === null
                ? prev
                : Number(record.lease_token);
            return Math.max(prev, incoming);
          })(),
          code_version:
            record.code_version === undefined || record.code_version === null
              ? (state.rows.find((r) => r.id === String(record.id))?.code_version ?? null)
              : String(record.code_version),
        };
        const idx = state.rows.findIndex((r) => r.id === next.id);
        if (idx >= 0) {
          const prev = state.rows[idx]!;
          next.created_at = prev.created_at;
          state.rows[idx] = next;
        } else state.rows.push(next);
        return { changes: 1 };
      }

      if (/^UPDATE\s+oke_journal_runs\s+SET\s+lease_expires_at\s*=\s*GREATEST/i.test(text)) {
        const id = String(params[1]);
        const row = state.rows.find((r) => r.id === id);
        if (
          !row ||
          !fenceHolds(state, id, String(params[2]), Number(params[3]), Number(params[4]))
        ) {
          return { changes: 0 };
        }
        const next = Number(params[0]);
        row.lease_expires_at = Math.max(row.lease_expires_at ?? 0, next);
        return { changes: 1 };
      }

      const updLease =
        /^UPDATE\s+oke_journal_runs\s+SET\s+locked_by\s*=\s*\?,\s*lease_expires_at\s*=\s*\?/i.exec(
          text,
        );
      if (updLease && /WHERE\s+id\s*=\s*\?/i.test(text) && !/locked_by\s*=\s*NULL/i.test(text)) {
        const id = String(params[params.length - 1]);
        const row = state.rows.find((r) => r.id === id);
        if (!row) return { changes: 0 };
        row.locked_by = params[0] === null ? null : String(params[0]);
        row.lease_expires_at =
          params[1] === null || params[1] === undefined ? null : Number(params[1]);
        if (/lease_token/i.test(text)) row.lease_token = (row.lease_token ?? 0) + 1;
        return { changes: 1 };
      }

      if (/^UPDATE\s+oke_journal_runs\s+SET\s+flow\s*=/i.test(text)) {
        return applyFencedHeader(state, text, params);
      }

      if (/^UPDATE\s+oke_journal_entries\s+SET\s+kind\s*=/i.test(text)) {
        const runId = String(params[5]);
        const seq = Number(params[6]);
        const fenceRun = String(params[7]);
        const lockedBy = String(params[8]);
        const token = Number(params[9]);
        const at = Number(params[10]);
        if (!fenceHolds(state, fenceRun, lockedBy, token, at)) return { changes: 0 };
        const idx = state.entries.findIndex((e) => e.run_id === runId && e.seq === seq);
        if (idx < 0) return { changes: 0 };
        const row = state.entries[idx]!;
        row.kind = String(params[0]);
        row.name = params[1] === null || params[1] === undefined ? null : String(params[1]);
        row.resource = params[2] === null || params[2] === undefined ? null : String(params[2]);
        row.value = params[3] === null || params[3] === undefined ? null : String(params[3]);
        row.at = Number(params[4]);
        return { changes: 1 };
      }

      if (/^INSERT\s+INTO\s+oke_journal_entries\b/i.test(text)) {
        const fenced = /WHERE\s+EXISTS/i.test(text);
        const row: JournalEntryDbRow = {
          run_id: String(params[0]),
          seq: Number(params[1]),
          kind: String(params[2]),
          name: params[3] === null || params[3] === undefined ? null : String(params[3]),
          resource: params[4] === null || params[4] === undefined ? null : String(params[4]),
          value: params[5] === null || params[5] === undefined ? null : String(params[5]),
          at: Number(params[6]),
        };
        if (
          fenced &&
          !fenceHolds(
            state,
            String(params[7]),
            String(params[8]),
            Number(params[9]),
            Number(params[10]),
          )
        ) {
          return { changes: 0 };
        }
        const idx = state.entries.findIndex((e) => e.run_id === row.run_id && e.seq === row.seq);
        if (idx >= 0) {
          if (/DO\s+NOTHING/i.test(text)) return { changes: 0 };
          state.entries[idx] = row;
          return { changes: 1 };
        }
        state.entries.push(row);
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

      if (text === IDEM_PURGE_SQL) {
        const now = Number(params[0]);
        const before = state.idem.length;
        state.idem = state.idem.filter((row) => row.expires_at > now);
        return { changes: before - state.idem.length };
      }
      if (text === IDEM_DELETE_EXPIRED_ONE_SQL) {
        const now = Number(params[4]);
        const idx = state.idem.findIndex((row) => idemPk(row, params) && row.expires_at <= now);
        if (idx < 0) return { changes: 0 };
        state.idem.splice(idx, 1);
        return { changes: 1 };
      }
      if (text === IDEM_INSERT_SQL) {
        if (state.idem.some((row) => idemPk(row, params))) return { changes: 0 };
        state.idem.push({
          tenant: String(params[0]),
          principal: String(params[1]),
          flow: String(params[2]),
          key: String(params[3]),
          fingerprint: String(params[4]),
          status: "in_progress",
          claim_token: String(params[5]),
          lease_expires_at: Number(params[6]),
          run_id: null,
          response_status: null,
          response_headers: null,
          response_body: null,
          created_at: Number(params[7]),
          expires_at: Number(params[8]),
        });
        return { changes: 1 };
      }
      if (text === IDEM_RECLAIM_SQL) {
        const row = state.idem.find(
          (candidate) =>
            idemPk(candidate, params, 2) && candidate.claim_token === String(params[6]),
        );
        if (row === undefined || row.status !== "in_progress") return { changes: 0 };
        row.claim_token = String(params[0]);
        row.lease_expires_at = Number(params[1]);
        return { changes: 1 };
      }
      if (text === IDEM_COMPLETE_SQL) {
        const row = state.idem.find(
          (candidate) =>
            idemPk(candidate, params, 4) && candidate.claim_token === String(params[8]),
        );
        if (row === undefined) return { changes: 0 };
        row.status = "completed";
        row.response_status = Number(params[0]);
        row.response_headers = params[1] === null ? null : String(params[1]);
        row.response_body = params[2] === null ? null : String(params[2]);
        if (params[3] !== null && params[3] !== undefined) row.run_id = String(params[3]);
        return { changes: 1 };
      }
      if (text === IDEM_REMOVE_SQL) {
        const idx = state.idem.findIndex(
          (candidate) => idemPk(candidate, params) && candidate.claim_token === String(params[4]),
        );
        if (idx < 0) return { changes: 0 };
        state.idem.splice(idx, 1);
        return { changes: 1 };
      }
      if (text === IDEM_RENEW_SQL) {
        const row = state.idem.find(
          (candidate) =>
            idemPk(candidate, params, 1) &&
            candidate.claim_token === String(params[5]) &&
            candidate.status === "in_progress",
        );
        if (row === undefined) return { changes: 0 };
        row.lease_expires_at = Number(params[0]);
        return { changes: 1 };
      }
      if (text === IDEM_ATTACH_SQL) {
        const row = state.idem.find(
          (candidate) =>
            idemPk(candidate, params, 1) && candidate.claim_token === String(params[5]),
        );
        if (row === undefined) return { changes: 0 };
        row.run_id = String(params[0]);
        return { changes: 1 };
      }
      if (/^INSERT\s+INTO\s+oke_decision_labels\b/i.test(text)) {
        state.labels.push({
          decision_id: String(params[0]),
          question: String(params[1]),
          value: String(params[2]),
          propensity: Number(params[3]),
          reviewer: String(params[4]),
          locale: params[5] === null || params[5] === undefined ? null : String(params[5]),
          model: params[6] === null || params[6] === undefined ? null : String(params[6]),
          tenant: params[7] === null || params[7] === undefined ? null : String(params[7]),
          score: params[8] === null || params[8] === undefined ? null : Number(params[8]),
          loss: params[9] === null || params[9] === undefined ? null : Number(params[9]),
          raw: params[10] === null || params[10] === undefined ? null : String(params[10]),
          at: Number(params[11]),
          input: params[12] === null || params[12] === undefined ? null : String(params[12]),
          review_id: params[13] === null || params[13] === undefined ? null : String(params[13]),
        });
        return { changes: 1 };
      }

      if (/^INSERT\s+INTO\s+oke_decision_candidates\b/i.test(text)) {
        const decisionId = String(params[0]);
        const body = String(params[1]);
        const idx = state.candidates.findIndex((row) => row.decision_id === decisionId);
        if (idx >= 0) state.candidates[idx] = { decision_id: decisionId, body };
        else state.candidates.push({ decision_id: decisionId, body });
        return { changes: 1 };
      }

      if (/^UPDATE\s+oke_decision_drift\b/i.test(text)) return { changes: 0 };

      if (/^DELETE\s+FROM\s+oke_decision_drift\b/i.test(text)) {
        const id = String(params[0] ?? "");
        const before = state.drift.length;
        state.drift = state.drift.filter((row) => row.decision_id !== id);
        return { changes: before - state.drift.length };
      }

      if (/^INSERT\s+INTO\s+oke_decision_drift\b/i.test(text)) {
        const decisionId = String(params[0]);
        const next = {
          decision_id: decisionId,
          suspended: Number(params[1]),
          certified_at: Number(params[2] ?? 0),
        };
        const idx = state.drift.findIndex((row) => row.decision_id === decisionId);
        if (idx >= 0) state.drift[idx] = next;
        else state.drift.push(next);
        return { changes: 1 };
      }

      if (/^UPDATE\s+oke_agent_run\s+SET\s+sweep_claim_at\b/i.test(text)) {
        const until = Number(params[0]);
        const runId = String(params[1] ?? "");
        const now = Number(params[2]);
        const row = state.agentRuns.find((candidate) => candidate.run_id === runId);
        if (!row) return { changes: 0 };
        if (row.sweep_claim_at !== null && row.sweep_claim_at > now) return { changes: 0 };
        row.sweep_claim_at = until;
        return { changes: 1 };
      }

      if (/^INSERT\s+INTO\s+oke_agent_run\b/i.test(text)) {
        const runId = String(params[0]);
        const existing = state.agentRuns.find((row) => row.run_id === runId);
        const next = {
          run_id: runId,
          header: String(params[1]),
          sweep_claim_at: existing?.sweep_claim_at ?? null,
        };
        const idx = state.agentRuns.findIndex((row) => row.run_id === runId);
        if (idx >= 0) state.agentRuns[idx] = next;
        else state.agentRuns.push(next);
        return { changes: 1 };
      }

      if (/^INSERT\s+INTO\s+oke_agent_event\b/i.test(text)) {
        const runId = String(params[0]);
        const seq = Number(params[1]);
        if (state.agentEvents.some((row) => row.run_id === runId && row.seq === seq)) {
          throw new Error(`duplicate key value violates unique constraint "oke_agent_event_pkey"`);
        }
        state.agentEvents.push({
          run_id: runId,
          seq,
          event: String(params[2]),
          event_type: params[3] === undefined || params[3] === null ? null : String(params[3]),
          event_name: params[4] === undefined || params[4] === null ? null : String(params[4]),
        });
        return { changes: 1 };
      }

      if (/^DELETE\s+FROM\s+oke_agent_event\b/i.test(text)) {
        const id = String(params[0] ?? "");
        const before = state.agentEvents.length;
        state.agentEvents = state.agentEvents.filter((row) => row.run_id !== id);
        return { changes: before - state.agentEvents.length };
      }

      if (/^DELETE\s+FROM\s+oke_agent_run\b/i.test(text)) {
        const id = String(params[0] ?? "");
        const before = state.agentRuns.length;
        state.agentRuns = state.agentRuns.filter((row) => row.run_id !== id);
        return { changes: before - state.agentRuns.length };
      }

      if (text === IDEM_FORFEIT_SQL) {
        const row = state.idem.find(
          (candidate) =>
            idemPk(candidate, params, 1) &&
            candidate.claim_token === String(params[5]) &&
            candidate.status === "in_progress",
        );
        if (row === undefined) return { changes: 0 };
        row.claim_token = String(params[0]);
        row.lease_expires_at = 0;
        return { changes: 1 };
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

const UPSERT_SQL = `INSERT INTO oke_journal_runs (id, flow, input, status, entries, wake_at, error, output, locked_by, lease_expires_at, created_at, updated_at, tenant, lease_token, code_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET flow = EXCLUDED.flow, input = EXCLUDED.input, status = EXCLUDED.status, entries = EXCLUDED.entries, wake_at = EXCLUDED.wake_at, error = EXCLUDED.error, output = EXCLUDED.output, locked_by = EXCLUDED.locked_by, lease_expires_at = EXCLUDED.lease_expires_at, created_at = oke_journal_runs.created_at, updated_at = EXCLUDED.updated_at, tenant = EXCLUDED.tenant, lease_token = GREATEST(COALESCE(oke_journal_runs.lease_token, 0), COALESCE(EXCLUDED.lease_token, 0)), code_version = EXCLUDED.code_version`;

/** Postgres journal store with run-level lease coordination. */
export type PostgresJournalStore = JournalStore &
  JournalLeaseStore & {
    readonly sql: PostgresJournalSql;
    /** Bytes written for entry rows plus header entry payloads. */
    readonly writeBytes: number;
    close(): Promise<void>;
  };

/**
 * Open decision tables on first use so a journal without decisions stays empty.
 *
 * @param sql - Journal SQL client
 */
function loadDecisionLabelModule(): typeof import("../kernel/decision-label-store.ts") {
  return lazyRequire(`${import.meta.dir}/../kernel`, ["decision", "label", "store"].join("-"));
}

function loadAgentEventModule(): typeof import("../kernel/agent-event-store.ts") {
  return lazyRequire(`${import.meta.dir}/../kernel`, ["agent", "event", "store"].join("-"));
}

function lazyDecisionLabels(sql: PostgresJournalSql): DecisionLabelStore {
  let pending: Promise<DecisionLabelStore> | undefined;
  const ready = (): Promise<DecisionLabelStore> => {
    pending ??= loadDecisionLabelModule().createPostgresDecisionLabelStore(sql);
    return pending;
  };
  return {
    insert: (label, at) => ready().then((store) => store.insert(label, at)),
    list: (decision, tenant) => ready().then((store) => store.list(decision, tenant)),
    drift: () => ready().then((store) => store.drift()),
    setDrift: (decision, record) => ready().then((store) => store.setDrift(decision, record)),
    putCandidate: (decision, entry) => ready().then((store) => store.putCandidate(decision, entry)),
    getCandidate: (decision) => ready().then((store) => store.getCandidate(decision)),
    listCandidates: () => ready().then((store) => store.listCandidates()),
  };
}

/**
 * Open the agent event tables on first use.
 *
 * @param sql - Journal SQL client
 */
function lazyAgentEvents(sql: PostgresJournalSql): AgentEventStore {
  let pending: Promise<AgentEventStore> | undefined;
  const ready = (): Promise<AgentEventStore> => {
    pending ??= loadAgentEventModule().createPostgresAgentEventStore(sql);
    return pending;
  };
  return {
    read: (runId) => ready().then((store) => store.read(runId)),
    readAfter: (runId, afterSeq) => ready().then((store) => store.readAfter(runId, afterSeq)),
    maxSeq: (runId) => ready().then((store) => store.maxSeq(runId)),
    readHeader: (runId) => ready().then((store) => store.readHeader(runId)),
    truncated: (runId) => ready().then((store) => store.truncated(runId)),
    claim: (runId) => ready().then((store) => store.claim(runId)),
    listHeaders: () => ready().then((store) => store.listHeaders()),
    writeHeader: (header) => ready().then((store) => store.writeHeader(header)),
    append: (runId, row) => ready().then((store) => store.append(runId, row)),
    remove: (runId) => ready().then((store) => store.remove(runId)),
  };
}

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

  let writeBytes = 0;

  async function hydrate(row: Record<string, unknown>): Promise<JournalRun> {
    const run = rowToRun(row);
    const entryRows = await sql.query(SELECT_ENTRIES_SQL, [run.id]);
    if (entryRows.length > 0) {
      (run as { entries: JournalEntry[] }).entries = entryRows.map((entry) => entryFromRow(entry));
      return run;
    }
    if (run.entries.length > 0) {
      for (let seq = 0; seq < run.entries.length; seq++) {
        const entry = run.entries[seq];
        if (!entry) continue;
        const params = entryToParams(run.id, seq, entry);
        writeBytes += JSON.stringify(entry).length;
        await sql.exec(INSERT_ENTRY_SQL, params);
      }
    }
    return run;
  }

  const store: PostgresJournalStore = {
    sql,
    get writeBytes() {
      return writeBytes;
    },
    idempotency: createPostgresIdempotencyStore(sql),
    decisions: lazyDecisionLabels(sql),
    agentEvents: lazyAgentEvents(sql),
    async get(runId) {
      const rows = await sql.query(`SELECT * FROM oke_journal_runs WHERE id = ?`, [runId]);
      if (!rows[0]) return undefined;
      return hydrate(rows[0]);
    },
    async put(run, fence) {
      writeBytes += JSON.stringify(run.entries).length;
      if (fence) {
        const wrote = await sql.exec(FENCED_HEADER_SQL, fencedHeaderParams(run, fence));
        if (wrote.changes === 0) throwOke("JOURNAL_STALE_LEASE", { runId: run.id });
        return;
      }
      await sql.exec(UPSERT_SQL, runToParams(run));
      for (let seq = 0; seq < run.entries.length; seq++) {
        const entry = run.entries[seq];
        if (!entry) continue;
        writeBytes += JSON.stringify(entry).length;
        await sql.exec(INSERT_ENTRY_SQL, entryToParams(run.id, seq, entry));
      }
    },
    async appendEntry(runId, seq, entry, fence) {
      writeBytes += JSON.stringify(entry).length;
      if (!fence) {
        await sql.exec(INSERT_ENTRY_SQL, entryToParams(runId, seq, entry));
        return;
      }
      const wrote = await sql.exec(APPEND_ENTRY_FENCED_SQL, [
        ...entryToParams(runId, seq, entry),
        runId,
        fence.lockedBy,
        fence.leaseToken,
        fence.now,
      ]);
      if (wrote.changes === 1) return;
      const stored = await sql.query(
        `SELECT * FROM oke_journal_entries WHERE run_id = ? AND seq = ?`,
        [runId, seq],
      );
      const row = stored[0];
      if (row && sameEntry(entryFromRow(row), entry)) return;
      throwOke("JOURNAL_STALE_LEASE", { runId });
    },
    async updateEntry(runId, seq, entry, fence) {
      writeBytes += JSON.stringify(entry).length;
      const params = entryToParams(runId, seq, entry);
      const wrote = await sql.exec(UPDATE_ENTRY_FENCED_SQL, [
        params[2],
        params[3],
        params[4],
        params[5],
        params[6],
        runId,
        seq,
        runId,
        fence.lockedBy,
        fence.leaseToken,
        fence.now,
      ]);
      if (wrote.changes === 0) throwOke("JOURNAL_STALE_LEASE", { runId });
    },
    async list() {
      const rows = await sql.query(`SELECT * FROM oke_journal_runs`);
      const runs: JournalRun[] = [];
      for (const row of rows) runs.push(await hydrate(row));
      return runs;
    },
    async acquireLease(runId, instanceId, now, leaseMs) {
      return sql.begin(async (tx) => {
        const claimed = await tx.query(CLAIM_LEASE_SQL, [runId, instanceId, now]);
        if (!claimed[0]) return false;
        await tx.exec(UPDATE_LEASE_SQL, [instanceId, now + leaseMs, runId]);
        return true;
      });
    },
    async cas(runId, instanceId, now, leaseMs, update) {
      return sql.begin(async (tx) => {
        const claimed = await tx.query(CLAIM_LEASE_SQL, [runId, instanceId, now]);
        const row = claimed[0];
        if (!row) {
          const exists = await tx.query(`SELECT * FROM oke_journal_runs WHERE id = ?`, [runId]);
          const held = exists[0];
          if (!held) return "missing";
          const current = rowToRun(held);
          return { lease: true, leaseExpiresAt: current.leaseExpiresAt };
        }
        const current = rowToRun(row);
        const entryRows = await tx.query(SELECT_ENTRIES_SQL, [runId]);
        if (entryRows.length > 0) {
          (current as { entries: JournalEntry[] }).entries = entryRows.map((entry) =>
            entryFromRow(entry),
          );
        }
        const next = update(current) ?? current;
        const heldToken = current.leaseToken ?? 0;
        const renew =
          current.lockedBy === instanceId &&
          current.leaseExpiresAt !== undefined &&
          current.leaseExpiresAt > now &&
          current.leaseToken !== undefined;
        next.lockedBy = instanceId;
        next.leaseExpiresAt = now + leaseMs;
        next.leaseToken = renew ? heldToken : heldToken + 1;
        const header = { ...next, entries: [] as JournalEntry[] };
        const wrote = await tx.exec(CAS_HEADER_SQL, casHeaderParams(header, heldToken));
        if (wrote.changes === 0) throwOke("JOURNAL_STALE_LEASE", { runId });
        const fence = { lockedBy: instanceId, leaseToken: next.leaseToken, now };
        for (let seq = 0; seq < next.entries.length; seq++) {
          const entry = next.entries[seq];
          if (!entry) continue;
          const prev = current.entries[seq];
          if (!prev) {
            const inserted = await tx.exec(APPEND_ENTRY_FENCED_SQL, [
              ...entryToParams(runId, seq, entry),
              runId,
              fence.lockedBy,
              fence.leaseToken,
              fence.now,
            ]);
            if (inserted.changes === 0) throwOke("JOURNAL_STALE_LEASE", { runId });
          } else if (!sameEntry(prev, entry)) {
            const params = entryToParams(runId, seq, entry);
            const updated = await tx.exec(UPDATE_ENTRY_FENCED_SQL, [
              params[2],
              params[3],
              params[4],
              params[5],
              params[6],
              runId,
              seq,
              runId,
              fence.lockedBy,
              fence.leaseToken,
              fence.now,
            ]);
            if (updated.changes === 0) throwOke("JOURNAL_STALE_LEASE", { runId });
          }
        }
        return "ok";
      });
    },
    async renewLeaseExpiry(runId, expiresAt, fence) {
      const wrote = await sql.exec(HEARTBEAT_SQL, [
        expiresAt,
        runId,
        fence.lockedBy,
        fence.leaseToken,
        fence.now,
      ]);
      return wrote.changes === 1;
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
        const run = rowToRun(row);
        run.lockedBy = instanceId;
        run.leaseExpiresAt = now + leaseMs;
        run.leaseToken = (run.leaseToken ?? 0) + 1;
        return run;
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
