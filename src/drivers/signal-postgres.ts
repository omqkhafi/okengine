/**
 * `postgres` signal driver — transactional emit (dual-write fix).
 *
 * `fx.emit` inserts into the outbox on the caller's connection. `once`
 * consumers claim with `FOR UPDATE SKIP LOCKED`. Broadcast and live stay
 * unread in the table; each instance polls `db_at` from an in-memory cursor.
 * Wakeups use `LISTEN` / `NOTIFY` when the client has them; otherwise the
 * boot scheduler polls `drain`.
 */

import type { SignalDecl } from "../elements/signal/declare.ts";
import type { SignalDelivery } from "../manifest/types.ts";
import { okid } from "../okid.ts";
import { DryRunWriteIsolationError, setDryRunMessageId, withDryRun } from "../kernel/dry-run.ts";
import { OkeError, OKE_ERRORS } from "../kernel/errors.ts";
import { LIVE_RESUME_GAP } from "../kernel/errors-live-resume.ts";
import {
  SIGNAL_DEFAULT_LEASE_MS,
  validateSignalEmitPayload,
  type DeadLetter,
  type LiveEvent,
  type LiveHandler,
  type SignalBus,
  type SignalDiscardOptions,
  type SignalDriver,
  type SignalEmitOptions,
  type SignalFailureReason,
  type SignalHandler,
  type SignalMessage,
  type SignalOpenOptions,
  type SignalReplayOptions,
  type SignalReplayResult,
  type SignalStats,
  type SignalTransaction,
  type SignalUnsubscribe,
  type LiveSubscribeOptions,
} from "./signal-types.ts";
import { createLiveIterable } from "./signal-live-iter.ts";
import { liveIdsToPrune, skipAfterId } from "./signal-retention.ts";

/** Row shape in `oke_signal_messages`. */
interface MsgRow {
  id: string;
  signal: string;
  payload: string;
  ordering_key: string | null;
  delivery: SignalDelivery;
  attempts: number;
  failures: string;
  created_at: number;
  available_at: number;
  status: "pending" | "inflight" | "delivered" | "dead";
  locked_by: string | null;
  lease_expires_at: number | null;
  delivered_to: string;
  parent_run_id: string | null;
  /** Database clock at insert (`clock_timestamp`), not the application clock. */
  db_at: number | null;
}

/** Minimal SQL + listen surface for the postgres signal driver. */
export interface PostgresSignalSql {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
  exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
  /**
   * Run `fn` inside a transaction. Nested calls join the outer txn.
   *
   * @param fn - Body
   */
  begin<T>(fn: (sql: PostgresSignalSql) => Promise<T>): Promise<T>;
  /**
   * LISTEN channel; returns unsubscribe.
   * Optional — Bun.SQL has no listen API. Omit it and poll {@link SignalBus.drain}.
   *
   * @param channel - Channel name
   * @param onNotify - Payload callback
   */
  listen?(channel: string, onNotify: (payload: string) => void): Promise<() => void>;
  /**
   * NOTIFY channel. Optional when the client cannot notify.
   *
   * @param channel - Channel name
   * @param payload - Payload
   */
  notify?(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

const CHANNEL = "oke_signal";

/** Claim next once-row: pending/unlocked or lease-expired, blocked by same-key inflight. */
const CLAIM_ONCE_SQL = `SELECT * FROM oke_signal_messages WHERE signal=? AND delivery='once' AND available_at<=? AND ((status='pending' AND locked_by IS NULL) OR (status='inflight' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)) AND (ordering_key IS NULL OR NOT EXISTS (SELECT 1 FROM oke_signal_messages h WHERE h.signal=oke_signal_messages.signal AND h.ordering_key=oke_signal_messages.ordering_key AND h.id<>oke_signal_messages.id AND h.status='inflight' AND h.lease_expires_at IS NOT NULL AND h.lease_expires_at>?)) ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;

/** `clock_timestamp()` in milliseconds. Stamped in SQL, not from the app clock. */
const DB_CLOCK_MS_SQL = `(extract(epoch from clock_timestamp())*1000)::bigint`;

/**
 * Default overlap window for postgres broadcast and live polls (ms).
 * A commit that lands more than this long after its `db_at` can be missed.
 */
export const POSTGRES_SIGNAL_DEFAULT_LAG_MS = 30_000;

/**
 * Broadcast/live statements the in-memory fake routes to one dedicated branch.
 * Inserts stamp `db_at` from `clock_timestamp()`.
 */
export const POSTGRES_SIGNAL_FANOUT_SQL = {
  /** Insert including `db_at` from the database clock. */
  insert: `INSERT INTO oke_signal_messages (id, signal, payload, ordering_key, delivery, attempts, failures, created_at, available_at, status, locked_by, lease_expires_at, delivered_to, parent_run_id, db_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ${DB_CLOCK_MS_SQL})`,
  /** Poll `db_at >=` and read the database clock from the same statement. */
  poll: `SELECT m.id, m.signal, m.payload, m.ordering_key, m.delivery, m.attempts, m.failures, m.created_at, m.available_at, m.status, m.locked_by, m.lease_expires_at, m.delivered_to, m.parent_run_id, m.db_at, ${DB_CLOCK_MS_SQL} AS db_now FROM (SELECT ${DB_CLOCK_MS_SQL} AS db_now) AS clock LEFT JOIN oke_signal_messages m ON m.delivery IN ('broadcast', 'live') AND m.db_at >= ?`,
  /** Backfill `db_at` from `created_at` (not 0). */
  backfill: `UPDATE oke_signal_messages SET db_at = created_at WHERE db_at IS NULL`,
  /** Supports the fan-out poll. */
  index: `CREATE INDEX IF NOT EXISTS oke_signal_messages_delivery_db_at ON oke_signal_messages (signal, delivery, db_at)`,
} as const;

/** Drop broadcast rows only after the overlap window has closed. */
const BROADCAST_TTL_DELETE_SQL = `DELETE FROM oke_signal_messages WHERE delivery = 'broadcast' AND db_at < ?`;

function isOnceClaim(text: string): boolean {
  return (
    /FOR\s+UPDATE\s+SKIP\s+LOCKED/i.test(text) &&
    /oke_signal_messages/i.test(text) &&
    /delivery\s*=\s*'once'/i.test(text)
  );
}

function isFanoutPoll(text: string): boolean {
  return /^SELECT\b/i.test(text) && /db_at\s*>=/i.test(text) && /clock_timestamp\s*\(/i.test(text);
}

function isSelectStatus(text: string): boolean {
  return /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+signal\s*=\s*\?\s+AND\s+status\s*=\s*\?\s*$/i.test(
    text,
  );
}

function isSelectPending(text: string): boolean {
  return /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+status\s+IN\s*\('pending',\s*'inflight'\)\s*$/i.test(
    text,
  );
}

function isSelectSignal(text: string): boolean {
  return /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+signal\s*=\s*\?\s*$/i.test(text);
}

function isSelectWrite(text: string): boolean {
  return /^SELECT\s+value\s+FROM\s+oke_signal_writes\s+WHERE\s+key\s*=\s*\?\s*$/i.test(text);
}

function isSelectId(text: string): boolean {
  return /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+id\s*=\s*\?\s*$/i.test(text);
}

function isSelectLive(text: string): boolean {
  return /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+signal\s*=\s*\?\s+AND\s+delivery\s*=\s*'live'\s+ORDER\s+BY\s+created_at\s+ASC\s*$/i.test(
    text,
  );
}

function isCreateTable(text: string): boolean {
  return /^CREATE\s+TABLE/i.test(text);
}

function isDeliveryDbAtIndex(text: string): boolean {
  return /^CREATE\s+INDEX\b/i.test(text) && /oke_signal_messages_delivery_db_at/i.test(text);
}

function isCreateIndex(text: string): boolean {
  return /^CREATE\s+INDEX/i.test(text) && !isDeliveryDbAtIndex(text);
}

function isBroadcastTtlDelete(text: string): boolean {
  return /^DELETE\s+FROM\s+oke_signal_messages\s+WHERE\s+delivery\s*=\s*'broadcast'\s+AND\s+db_at\s*<\s*\?\s*$/i.test(
    text,
  );
}

function isDeleteLive(text: string): boolean {
  return /^DELETE\s+FROM\s+oke_signal_messages\s+WHERE\s+id\s*=\s*\?\s+AND\s+delivery\s*=\s*'live'\s*$/i.test(
    text,
  );
}

function isDeleteDead(text: string): boolean {
  return /^DELETE\s+FROM\s+oke_signal_messages\s+WHERE\s+id\s*=\s*\?\s+AND\s+signal\s*=\s*\?\s+AND\s+status\s*=\s*'dead'\s*$/i.test(
    text,
  );
}

function isInsertDbAt(text: string): boolean {
  return /^INSERT\s+INTO\s+oke_signal_messages\b/i.test(text) && /clock_timestamp\s*\(/i.test(text);
}

function isInsertMessage(text: string): boolean {
  return (
    /^INSERT\s+INTO\s+oke_signal_messages\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$/i.test(text) &&
    !isInsertDbAt(text)
  );
}

function isInsertWrite(text: string): boolean {
  return /^INSERT\s+INTO\s+oke_signal_writes\s*\(key,\s*value\)\s*VALUES\s*\(\?,\s*\?\)\s*$/i.test(
    text,
  );
}

function isBackfillDbAt(text: string): boolean {
  return /^UPDATE\s+oke_signal_messages\s+SET\s+db_at\s*=\s*created_at\s+WHERE\s+db_at\s+IS\s+NULL\s*$/i.test(
    text,
  );
}

function isUpdateById(text: string): boolean {
  return (
    /^UPDATE\s+oke_signal_messages\s+SET\s+(.+)\s+WHERE\s+id\s*=\s*\?\s*$/i.test(text) &&
    !isBackfillDbAt(text)
  );
}

function isAlterAddColumn(text: string): boolean {
  return /^ALTER\s+TABLE\s+oke_signal_messages\s+ADD\s+COLUMN/i.test(text);
}

const POSTGRES_SIGNAL_FAKE_BRANCHES: ReadonlyArray<{
  readonly name: string;
  readonly test: (text: string) => boolean;
}> = [
  { name: "once-claim", test: isOnceClaim },
  { name: "fanout-poll", test: isFanoutPoll },
  { name: "select-status", test: isSelectStatus },
  { name: "select-pending", test: isSelectPending },
  { name: "select-signal", test: isSelectSignal },
  { name: "select-write", test: isSelectWrite },
  { name: "select-id", test: isSelectId },
  { name: "select-live", test: isSelectLive },
  { name: "create-table", test: isCreateTable },
  { name: "index-delivery-db-at", test: isDeliveryDbAtIndex },
  { name: "create-index", test: isCreateIndex },
  { name: "delete-broadcast-ttl", test: isBroadcastTtlDelete },
  { name: "delete-live", test: isDeleteLive },
  { name: "delete-dead", test: isDeleteDead },
  { name: "insert-db-at", test: isInsertDbAt },
  { name: "insert-message", test: isInsertMessage },
  { name: "insert-write", test: isInsertWrite },
  { name: "backfill-db-at", test: isBackfillDbAt },
  { name: "update-by-id", test: isUpdateById },
  { name: "alter-add-column", test: isAlterAddColumn },
];

/**
 * In-memory fake branches whose predicates match `sql`.
 *
 * Broadcast/live statements must match exactly one branch so a broader
 * regex cannot swallow them.
 *
 * @param sql - Statement text
 */
export function postgresSignalFakeBranches(sql: string): readonly string[] {
  const text = sql.trim();
  const names: string[] = [];
  for (const branch of POSTGRES_SIGNAL_FAKE_BRANCHES) {
    if (branch.test(text)) names.push(branch.name);
  }
  return names;
}

function fieldText(value: unknown, fallback: string): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return fallback;
}

function msgRowFromFields(row: Record<string, unknown>): MsgRow {
  const orderingKey = row.ordering_key;
  const parentRunId = row.parent_run_id;
  return {
    id: fieldText(row.id, ""),
    signal: fieldText(row.signal, ""),
    payload: fieldText(row.payload, "null"),
    ordering_key:
      orderingKey === undefined || orderingKey === null ? null : fieldText(orderingKey, ""),
    delivery: row.delivery as SignalDelivery,
    attempts: Number(row.attempts ?? 0),
    failures: fieldText(row.failures, "[]"),
    created_at: Number(row.created_at),
    available_at: Number(row.available_at),
    status: (row.status as MsgRow["status"]) ?? "pending",
    locked_by: (row.locked_by as string | null) ?? null,
    lease_expires_at:
      row.lease_expires_at === undefined || row.lease_expires_at === null
        ? null
        : Number(row.lease_expires_at),
    delivered_to: fieldText(row.delivered_to, "[]"),
    parent_run_id:
      parentRunId === undefined || parentRunId === null ? null : fieldText(parentRunId, ""),
    db_at: row.db_at === undefined || row.db_at === null ? null : Number(row.db_at),
  };
}

/**
 * In-memory Postgres-protocol fake with transactions, SKIP LOCKED, LISTEN/NOTIFY.
 */
export function createPostgresSignalFake(options?: {
  readonly now?: () => number;
  readonly durablePath?: string;
}): PostgresSignalSql & {
  /** Force-kill mid-transaction (drops uncommitted state). */
  killActiveTransaction(): void;
} {
  const clock = options?.now ?? (() => Date.now());
  const listeners = new Map<string, Set<(payload: string) => void>>();

  type State = {
    messages: MsgRow[];
    writes: Map<string, unknown>;
  };

  let committed: State = { messages: [], writes: new Map() };
  let active: { state: State; done: boolean } | null = null;

  async function hydrate(): Promise<void> {
    if (!options?.durablePath) return;
    const file = Bun.file(options.durablePath);
    if (!(await file.exists())) return;
    const text = await file.text();
    if (!text.trim()) return;
    const snap = JSON.parse(text) as {
      messages: MsgRow[];
      writes: Array<[string, unknown]>;
    };
    committed = {
      messages: snap.messages.map((m) => ({
        ...m,
        ordering_key: m.ordering_key ?? null,
        lease_expires_at: m.lease_expires_at ?? null,
        parent_run_id: m.parent_run_id ?? null,
        db_at: m.db_at ?? null,
      })),
      writes: new Map(snap.writes),
    };
  }

  async function persist(): Promise<void> {
    if (!options?.durablePath) return;
    const { mkdir } = await import("node:fs/promises");
    const { dirname } = await import("node:path");
    await mkdir(dirname(options.durablePath), { recursive: true });
    await Bun.write(
      options.durablePath,
      JSON.stringify({
        messages: committed.messages,
        writes: [...committed.writes.entries()],
      }),
    );
  }

  // Eager load if durable — open() will await ensureReady.
  let ready: Promise<void> | null = null;
  function ensureReady(): Promise<void> {
    if (!ready) ready = hydrate();
    return ready;
  }

  function view(): State {
    return active?.state ?? committed;
  }

  function cloneState(s: State): State {
    return {
      messages: s.messages.map((m) => ({ ...m })),
      writes: new Map(s.writes),
    };
  }

  const api: PostgresSignalSql & {
    killActiveTransaction(): void;
    _ensureReady: () => Promise<void>;
  } = {
    _ensureReady: ensureReady,
    killActiveTransaction() {
      active = null;
    },
    async query(sql, params = []) {
      await ensureReady();
      const text = sql.trim();
      const state = view();

      // Claim: SELECT … FOR UPDATE SKIP LOCKED (pending or lease-expired inflight),
      // with per-key serialization when ordering_key is set.
      if (isOnceClaim(text)) {
        const signal = String(params[0]);
        const t = Number(params[1]);
        const leaseCutoff = Number(params[2]);
        const keyLeaseCutoff = params.length >= 4 ? Number(params[3]) : t;
        const row = state.messages.find((m) => {
          if (m.signal !== signal || m.delivery !== "once" || m.available_at > t) return false;
          const pendingOk = m.status === "pending" && m.locked_by === null;
          const leaseExpired =
            m.status === "inflight" &&
            m.lease_expires_at !== null &&
            m.lease_expires_at <= leaseCutoff;
          if (!pendingOk && !leaseExpired) return false;
          if (m.ordering_key != null && m.ordering_key !== "") {
            const blocked = state.messages.some(
              (other) =>
                other.id !== m.id &&
                other.signal === m.signal &&
                other.ordering_key === m.ordering_key &&
                other.status === "inflight" &&
                other.lease_expires_at !== null &&
                other.lease_expires_at > keyLeaseCutoff,
            );
            if (blocked) return false;
          }
          return true;
        });
        if (!row) return [];
        // Hold the row before yielding so a concurrent claim skips it.
        row.status = "inflight";
        if (row.locked_by === null) row.locked_by = "claimed";
        return [{ ...row }];
      }

      // Before broader SELECTs: poll reads db_at and the database clock together.
      if (isFanoutPoll(text)) {
        const lower = Number(params[0]);
        const dbNow = clock();
        const matched = state.messages.filter(
          (m) =>
            (m.delivery === "broadcast" || m.delivery === "live") &&
            m.db_at != null &&
            m.db_at >= lower,
        );
        if (matched.length === 0) return [{ db_now: dbNow }];
        return matched.map((m) => ({ ...m, db_now: dbNow }));
      }

      if (isSelectStatus(text)) {
        return state.messages
          .filter((m) => m.signal === params[0] && m.status === params[1])
          .map((m) => ({ ...m }));
      }

      if (isSelectPending(text)) {
        return state.messages
          .filter((m) => m.status === "pending" || m.status === "inflight")
          .map((m) => ({ ...m }));
      }

      if (isSelectSignal(text)) {
        return state.messages.filter((m) => m.signal === params[0]).map((m) => ({ ...m }));
      }

      if (isSelectWrite(text)) {
        const v = state.writes.get(String(params[0]));
        if (v === undefined) return [];
        return [{ value: JSON.stringify(v) }];
      }

      if (isSelectId(text)) {
        return state.messages.filter((m) => m.id === params[0]).map((m) => ({ ...m }));
      }

      if (isSelectLive(text)) {
        return state.messages
          .filter((m) => m.signal === params[0] && m.delivery === "live")
          .map((m) => ({ ...m }));
      }

      throw new Error(`postgres signal fake: unsupported query: ${sql}`);
    },
    async exec(sql, params = []) {
      await ensureReady();
      const text = sql.trim();
      const state = view();

      if (isCreateTable(text)) return { changes: 0 };
      // Dedicated index branch before the broader CREATE INDEX match.
      if (isDeliveryDbAtIndex(text)) return { changes: 0 };
      if (isCreateIndex(text)) return { changes: 0 };

      if (isBroadcastTtlDelete(text)) {
        const cutoff = Number(params[0]);
        let changes = 0;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i]!;
          if (m.delivery === "broadcast" && m.db_at != null && m.db_at < cutoff) {
            state.messages.splice(i, 1);
            changes += 1;
          }
        }
        return { changes };
      }

      if (isDeleteLive(text)) {
        let changes = 0;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i]!;
          if (m.id === params[0] && m.delivery === "live") {
            state.messages.splice(i, 1);
            changes += 1;
          }
        }
        return { changes };
      }

      if (isDeleteDead(text)) {
        let changes = 0;
        for (let i = state.messages.length - 1; i >= 0; i--) {
          const m = state.messages[i]!;
          if (m.id === params[0] && m.signal === params[1] && m.status === "dead") {
            state.messages.splice(i, 1);
            changes += 1;
          }
        }
        return { changes };
      }

      // Before the generic INSERT: `db_at` is `clock_timestamp()`, not a placeholder.
      if (isInsertDbAt(text)) {
        const head =
          /^INSERT\s+INTO\s+oke_signal_messages\s*\(([^)]+)\)\s*VALUES\s*\((.*)\)\s*$/i.exec(text);
        if (!head) throw new Error(`postgres signal fake: unsupported exec: ${sql}`);
        const cols = head[1]!.split(",").map((c) => c.trim());
        const fields: Record<string, unknown> = {};
        let pi = 0;
        for (const col of cols) {
          if (col === "db_at") {
            fields.db_at = clock();
            continue;
          }
          fields[col] = params[pi++];
        }
        state.messages.push(msgRowFromFields(fields));
        return { changes: 1 };
      }

      const insertMsg = isInsertMessage(text)
        ? /^INSERT\s+INTO\s+oke_signal_messages\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$/i.exec(
            text,
          )
        : null;
      if (insertMsg) {
        const cols = insertMsg[1]!.split(",").map((c) => c.trim());
        const row: Record<string, unknown> = {};
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        state.messages.push(msgRowFromFields(row));
        return { changes: 1 };
      }

      if (isInsertWrite(text)) {
        state.writes.set(String(params[0]), JSON.parse(String(params[1])));
        return { changes: 1 };
      }

      // Before the generic UPDATE: backfill `db_at` from `created_at`.
      if (isBackfillDbAt(text)) {
        let changes = 0;
        for (const m of state.messages) {
          if (m.db_at == null) {
            m.db_at = m.created_at;
            changes += 1;
          }
        }
        return { changes };
      }

      const upd = isUpdateById(text)
        ? /^UPDATE\s+oke_signal_messages\s+SET\s+(.+)\s+WHERE\s+id\s*=\s*\?\s*$/i.exec(text)
        : null;
      if (upd) {
        const id = String(params[params.length - 1]);
        const row = state.messages.find((m) => m.id === id);
        if (!row) return { changes: 0 };
        const sets = upd[1]!.split(",").map((s) => s.trim());
        let pi = 0;
        const mut = row as unknown as Record<string, unknown>;
        for (const set of sets) {
          const [col, rhs] = set.split("=").map((x) => x.trim());
          if (rhs === "?") {
            mut[col!] = params[pi++];
          } else if (rhs === "NULL") {
            mut[col!] = null;
          } else if (
            (rhs?.startsWith("'") && rhs.endsWith("'")) ||
            (rhs?.startsWith('"') && rhs.endsWith('"'))
          ) {
            mut[col!] = rhs.slice(1, -1);
          }
        }
        return { changes: 1 };
      }

      if (isAlterAddColumn(text)) {
        return { changes: 0 };
      }

      throw new Error(`postgres signal fake: unsupported exec: ${sql}`);
    },
    async begin(fn) {
      await ensureReady();
      if (active && !active.done) {
        // Join caller's transaction (dual-write enrolment).
        return fn(api);
      }
      active = { state: cloneState(committed), done: false };
      try {
        const result = await fn(api);
        if (active) {
          committed = active.state;
          active.done = true;
          active = null;
          await persist();
        }
        return result;
      } catch (err) {
        active = null;
        throw err;
      }
    },
    async listen(channel, onNotify) {
      let set = listeners.get(channel);
      if (!set) {
        set = new Set();
        listeners.set(channel, set);
      }
      set.add(onNotify);
      return () => {
        set!.delete(onNotify);
      };
    },
    async notify(channel, payload) {
      const set = listeners.get(channel);
      if (!set) return;
      for (const fn of set) fn(payload);
    },
    async close() {
      listeners.clear();
      active = null;
    },
  };

  return api;
}

async function ensureSchema(sql: PostgresSignalSql): Promise<void> {
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_signal_messages (
    id TEXT PRIMARY KEY,
    signal TEXT,
    payload TEXT,
    ordering_key TEXT,
    delivery TEXT,
    attempts INTEGER,
    failures TEXT,
    created_at BIGINT,
    available_at BIGINT,
    status TEXT,
    locked_by TEXT,
    lease_expires_at BIGINT,
    delivered_to TEXT,
    parent_run_id TEXT,
    db_at BIGINT
  )`);
  // Existing tables created before leases / keys: add columns in place.
  try {
    await sql.exec(
      `ALTER TABLE oke_signal_messages ADD COLUMN IF NOT EXISTS lease_expires_at BIGINT`,
    );
  } catch {
    /* fake / older engines without IF NOT EXISTS — ignore */
  }
  try {
    await sql.exec(`ALTER TABLE oke_signal_messages ADD COLUMN IF NOT EXISTS ordering_key TEXT`);
  } catch {
    /* fake / older engines without IF NOT EXISTS — ignore */
  }
  try {
    await sql.exec(`ALTER TABLE oke_signal_messages ADD COLUMN IF NOT EXISTS parent_run_id TEXT`);
  } catch {
    /* fake / older engines without IF NOT EXISTS — ignore */
  }
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_signal_writes (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
  try {
    await sql.exec(
      `CREATE INDEX IF NOT EXISTS oke_signal_messages_live_created ON oke_signal_messages (signal, delivery, created_at)`,
    );
  } catch {
    /* fake / older engines without IF NOT EXISTS — ignore */
  }
  try {
    await sql.exec(`ALTER TABLE oke_signal_messages ADD COLUMN IF NOT EXISTS db_at BIGINT`);
  } catch {
    /* fake / older engines without IF NOT EXISTS — ignore */
  }
  try {
    await sql.exec(POSTGRES_SIGNAL_FANOUT_SQL.backfill);
  } catch {
    /* fake / older engines — ignore */
  }
  try {
    await sql.exec(POSTGRES_SIGNAL_FANOUT_SQL.index);
  } catch {
    /* fake / older engines without IF NOT EXISTS — ignore */
  }
}

function rowToMessage(row: Record<string, unknown>): SignalMessage {
  const key =
    row.ordering_key === undefined || row.ordering_key === null || row.ordering_key === ""
      ? undefined
      : String(row.ordering_key);
  const parentRunId =
    row.parent_run_id === undefined || row.parent_run_id === null || row.parent_run_id === ""
      ? undefined
      : String(row.parent_run_id);
  return {
    id: String(row.id),
    signal: String(row.signal),
    payload: JSON.parse(String(row.payload)),
    ...(key !== undefined ? { key } : {}),
    ...(parentRunId !== undefined ? { parentRunId } : {}),
    delivery: row.delivery as SignalDelivery,
    attempts: Number(row.attempts),
    failures: JSON.parse(String(row.failures ?? "[]")) as SignalFailureReason[],
    createdAt: Number(row.created_at),
    availableAt: Number(row.available_at),
    status: row.status as SignalMessage["status"],
  };
}

/**
 * Options for {@link openPostgresSignal}.
 */
export interface PostgresSignalOpenOptions extends SignalOpenOptions {
  /**
   * Overlap window (ms) for broadcast and live polls.
   * Rows with `db_at >= cursor - lagMs` are re-read and deduped by id.
   * Defaults to {@link POSTGRES_SIGNAL_DEFAULT_LAG_MS}.
   */
  readonly lagMs?: number;
}

/**
 * Open a postgres-backed signal bus.
 *
 * @param options - Declarations / sql fake / clock / lag window
 */
export async function openPostgresSignal(options: PostgresSignalOpenOptions): Promise<SignalBus> {
  const now = options.now ?? (() => Date.now());
  const signals = options.signals;
  const leaseMs = options.leaseMs ?? SIGNAL_DEFAULT_LEASE_MS;
  const lagMs = options.lagMs ?? POSTGRES_SIGNAL_DEFAULT_LAG_MS;
  // Broadcast retention stays strictly longer than the overlap window.
  // Live retention stays on pruneLive (default unbounded).
  const broadcastTtlMs = lagMs + 1_000;
  const sql =
    (options.sql as PostgresSignalSql | undefined) ??
    createPostgresSignalFake({
      now,
      durablePath: options.durablePath,
    });

  if ("_ensureReady" in sql && typeof sql._ensureReady === "function") {
    await (sql as { _ensureReady: () => Promise<void> })._ensureReady();
  }
  await ensureSchema(sql);

  // Best-effort within lagMs. A transaction that commits more than lagMs
  // after its db_at can be missed. Not gap-free ordering. No persisted cursor table.
  let fanoutCursor = 0;
  const fanoutSeen = new Map<string, number>();

  async function readFanout(lower: number): Promise<{
    rows: Record<string, unknown>[];
    dbNow: number;
  }> {
    const raw = await sql.query(POSTGRES_SIGNAL_FANOUT_SQL.poll, [lower]);
    let dbNow = Number.NaN;
    const rows: Record<string, unknown>[] = [];
    for (const row of raw) {
      if (Number.isNaN(dbNow)) dbNow = Number(row.db_now);
      if (row.id == null) continue;
      rows.push(row);
    }
    if (!Number.isFinite(dbNow)) {
      throw new Error("postgres signal: fanout poll did not return db_now");
    }
    return { rows, dbNow };
  }

  // Start at the current database time so messages committed while this
  // instance was offline are already behind the cursor.
  const bootSnap = await readFanout(Number.MIN_SAFE_INTEGER);
  fanoutCursor = bootSnap.dbNow;
  for (const row of bootSnap.rows) {
    fanoutSeen.set(String(row.id), bootSnap.dbNow);
  }

  const consumers: Array<{
    signal: string;
    subscriberId: string;
    handler: SignalHandler;
  }> = [];
  const liveHandlers = new Map<string, Set<LiveHandler>>();
  const deliveredAt: number[] = [];
  const recentLive = new Map<string, unknown[]>();
  const subscriberErrors = new Map<string, number>();
  let unlisten: (() => void) | null = null;
  let draining: Promise<void> | null = null;

  function failureFromError(err: unknown, attempt: number): SignalFailureReason {
    const code =
      err &&
      typeof err === "object" &&
      "code" in err &&
      typeof (err as { code: unknown }).code === "string"
        ? (err as { code: string }).code
        : err instanceof Error && err.name !== "Error"
          ? err.name
          : "handler_error";
    return {
      code,
      message: err instanceof Error ? err.message : String(err),
      at: now(),
      attempt,
    };
  }

  function noteDelivered(): void {
    const t = now();
    deliveredAt.push(t);
    while (deliveredAt.length > 0 && deliveredAt[0]! < t - 1_000) {
      deliveredAt.shift();
    }
  }

  function throughputPerSec(): number {
    const t = now();
    let n = 0;
    for (let i = deliveredAt.length - 1; i >= 0; i--) {
      if (deliveredAt[i]! < t - 1_000) break;
      n += 1;
    }
    return n;
  }

  if (typeof sql.listen === "function") {
    unlisten = await sql.listen(CHANNEL, () => {
      void drainQuiet();
    });
  } else if ((options.pollMs ?? 0) > 0) {
    const timer = setInterval(() => {
      void drainQuiet();
    }, options.pollMs);
    unlisten = () => {
      clearInterval(timer);
    };
  }

  function requireDecl(name: string): SignalDecl {
    const decl = signals.get(name);
    if (!decl) throw new Error(`Unknown signal: ${name}`);
    return decl;
  }

  function hasSubscriber(name: string): boolean {
    if (consumers.some((c) => c.signal === name)) return true;
    const live = liveHandlers.get(name);
    return live !== undefined && live.size > 0;
  }

  function assertEmitAllowed(name: string): void {
    const decl = requireDecl(name);
    if (decl.optional) return;
    if (hasSubscriber(name)) return;
    throw new OkeError(OKE_ERRORS.ORPHAN_EMIT, {
      flow: "unknown",
      resource: name,
    });
  }

  async function insertEmit(
    tx: PostgresSignalSql,
    signal: string,
    payload: unknown,
    options?: SignalEmitOptions,
  ): Promise<void> {
    const decl = requireDecl(signal);
    const t = now();
    const orderingKey =
      typeof options?.key === "string" && options.key.length > 0 ? options.key : null;
    const parentRunId =
      typeof options?.parentRunId === "string" && options.parentRunId.length > 0
        ? options.parentRunId
        : null;
    await tx.exec(POSTGRES_SIGNAL_FANOUT_SQL.insert, [
      okid(),
      signal,
      JSON.stringify(payload ?? null),
      orderingKey,
      decl.delivery,
      0,
      "[]",
      t,
      t,
      "pending",
      null,
      null,
      "[]",
      parentRunId,
    ]);
  }

  async function begin(): Promise<SignalTransaction> {
    let finished = false;
    // Defer the real SQL begin until commit so staging is local,
    // then enrol everything in one postgres transaction.
    const stagedEmits: Array<{
      signal: string;
      payload: unknown;
      options?: SignalEmitOptions;
    }> = [];
    const stagedWrites = new Map<string, unknown>();

    return {
      async write(key, value) {
        if (finished) throw new Error("transaction finished");
        stagedWrites.set(key, value);
      },
      async emit(signal, payload, options) {
        if (finished) throw new Error("transaction finished");
        assertEmitAllowed(signal);
        // Validate before staging so commit never sees an invalid payload.
        const value = await validateSignalEmitPayload(signal, requireDecl(signal), payload);
        stagedEmits.push({ signal, payload: value, options });
      },
      async commit() {
        if (finished) throw new Error("transaction finished");
        finished = true;
        await sql.begin(async (tx) => {
          for (const [k, v] of stagedWrites) {
            await tx.exec(`INSERT INTO oke_signal_writes (key, value) VALUES (?, ?)`, [
              k,
              JSON.stringify(v),
            ]);
          }
          for (const e of stagedEmits) {
            await insertEmit(tx, e.signal, e.payload, e.options);
          }
        });
        if (typeof sql.notify === "function") {
          await sql.notify(CHANNEL, "commit");
        }
      },
      async rollback() {
        if (finished) throw new Error("transaction finished");
        finished = true;
        stagedEmits.length = 0;
        stagedWrites.clear();
      },
    };
  }

  /**
   * Enrol emit in an already-open SQL transaction (dual-write fix).
   *
   * @param tx - Caller's postgres transaction
   * @param signal - Signal name
   * @param payload - Payload
   * @param options - Optional emit options
   */
  async function emitInTransaction(
    tx: PostgresSignalSql,
    signal: string,
    payload?: unknown,
    options?: SignalEmitOptions,
  ): Promise<void> {
    assertEmitAllowed(signal);
    const value = await validateSignalEmitPayload(signal, requireDecl(signal), payload);
    await insertEmit(tx, signal, value, options);
  }

  async function emit(
    signal: string,
    payload?: unknown,
    options?: SignalEmitOptions,
  ): Promise<void> {
    const tx = await begin();
    await tx.emit(signal, payload, options);
    await tx.commit();
  }

  async function subscribe(
    signal: string,
    subscriberId: string,
    handler: SignalHandler,
  ): Promise<SignalUnsubscribe> {
    requireDecl(signal);
    const entry = { signal, subscriberId, handler };
    consumers.push(entry);
    return () => {
      const i = consumers.indexOf(entry);
      if (i >= 0) consumers.splice(i, 1);
    };
  }

  function live(signal: string, opts?: LiveSubscribeOptions): AsyncIterable<LiveEvent> {
    const decl = requireDecl(signal);
    if (decl.delivery !== "live") {
      throw new Error(`signal "${signal}" is not delivery: "live"`);
    }
    const afterId = opts?.afterId;
    return createLiveIterable(async (emit) => {
      await pruneLive(signal);
      const historyRows = await sql.query(
        `SELECT * FROM oke_signal_messages WHERE signal = ? AND delivery = 'live' ORDER BY created_at ASC`,
        [signal],
      );
      const history: LiveEvent[] = historyRows.map((row) => ({
        id: String(row.id),
        payload: JSON.parse(String(row.payload)),
      }));
      const skipped = skipAfterId(history, afterId);
      if (afterId !== undefined && afterId.length > 0 && !skipped.found) {
        throw new OkeError(LIVE_RESUME_GAP, { signal, afterId });
      }
      let set = liveHandlers.get(signal);
      if (!set) {
        set = new Set();
        liveHandlers.set(signal, set);
      }
      const handler: LiveHandler = (event) => {
        emit(event);
      };
      set.add(handler);
      for (const event of skipped.rest) {
        emit(event);
      }
      return () => {
        set.delete(handler);
      };
    });
  }

  async function checkLiveResume(signal: string, afterId: string): Promise<void> {
    requireDecl(signal);
    await pruneLive(signal);
    const history = await sql.query(
      `SELECT * FROM oke_signal_messages WHERE signal = ? AND delivery = 'live' ORDER BY created_at ASC`,
      [signal],
    );
    if (!history.some((row) => String(row.id) === afterId)) {
      throw new OkeError(LIVE_RESUME_GAP, { signal, afterId });
    }
  }

  async function pruneLive(signal: string): Promise<void> {
    const decl = signals.get(signal);
    if (decl?.retention === undefined) return;
    const history = await sql.query(
      `SELECT * FROM oke_signal_messages WHERE signal = ? AND delivery = 'live' ORDER BY created_at ASC`,
      [signal],
    );
    const drop = liveIdsToPrune(
      history.map((row) => ({ id: String(row.id), createdAt: Number(row.created_at) })),
      decl.retention,
      now(),
    );
    for (const id of drop) {
      await sql.exec(`DELETE FROM oke_signal_messages WHERE id = ? AND delivery = 'live'`, [id]);
    }
  }

  async function deliverOnce(
    row: Record<string, unknown>,
    consumer: { subscriberId: string; handler: SignalHandler },
  ): Promise<void> {
    const decl = requireDecl(String(row.signal));
    const msg = rowToMessage(row);
    try {
      await consumer.handler(msg);
      await sql.exec(
        `UPDATE oke_signal_messages SET status = ?, locked_by = NULL, lease_expires_at = NULL WHERE id = ?`,
        ["delivered", msg.id],
      );
      noteDelivered();
    } catch (err) {
      const failures = [...msg.failures, failureFromError(err, msg.attempts)];
      if (msg.attempts > decl.retries) {
        await sql.exec(
          `UPDATE oke_signal_messages SET status = ?, locked_by = NULL, lease_expires_at = NULL, failures = ? WHERE id = ?`,
          [decl.deadLetter ? "dead" : "delivered", JSON.stringify(failures), msg.id],
        );
      } else {
        await sql.exec(
          `UPDATE oke_signal_messages SET status = ?, locked_by = NULL, lease_expires_at = NULL, failures = ?, available_at = ? WHERE id = ?`,
          ["pending", JSON.stringify(failures), now(), msg.id],
        );
      }
    }
  }

  async function drainQuiet(): Promise<void> {
    try {
      await drain();
    } catch {
      /* ignore during teardown */
    }
  }

  async function drainOncePass(): Promise<boolean> {
    let progress = false;
    const t = now();
    for (const consumer of consumers) {
      const decl = signals.get(consumer.signal);
      if (decl?.delivery !== "once") continue;
      const row = await sql.begin(async (tx) => {
        const claimed = await tx.query(CLAIM_ONCE_SQL, [consumer.signal, t, t, t]);
        const hit = claimed[0];
        if (!hit) return undefined;
        const attempts = Number(hit.attempts) + 1;
        const leaseExpiresAt = t + leaseMs;
        await tx.exec(
          `UPDATE oke_signal_messages SET status = 'inflight', locked_by = ?, attempts = ?, lease_expires_at = ? WHERE id = ?`,
          [consumer.subscriberId, attempts, leaseExpiresAt, hit.id],
        );
        hit.locked_by = consumer.subscriberId;
        hit.attempts = attempts;
        hit.status = "inflight";
        hit.lease_expires_at = leaseExpiresAt;
        return hit;
      });
      if (row) {
        progress = true;
        await deliverOnce(row, consumer);
      }
    }
    return progress;
  }

  async function drainFanoutPass(): Promise<boolean> {
    let progress = false;
    const snap = await readFanout(fanoutCursor - lagMs);
    const liveSignals = new Set<string>();
    for (const row of snap.rows) {
      const id = String(row.id);
      if (fanoutSeen.has(id)) continue;
      const delivery = String(row.delivery);
      if (delivery === "broadcast") {
        const name = String(row.signal);
        const subs = consumers.filter((c) => c.signal === name);
        if (subs.length === 0) continue;
        fanoutSeen.set(id, snap.dbNow);
        progress = true;
        const msg = rowToMessage(row);
        for (const consumer of subs) {
          try {
            await consumer.handler(msg);
            noteDelivered();
          } catch (err) {
            const failures = [...msg.failures, failureFromError(err, msg.attempts + 1)];
            const key = `${name}::${consumer.subscriberId}`;
            subscriberErrors.set(key, (subscriberErrors.get(key) ?? 0) + 1);
            await sql.exec(`UPDATE oke_signal_messages SET failures = ? WHERE id = ?`, [
              JSON.stringify(failures),
              id,
            ]);
          }
        }
      } else if (delivery === "live") {
        fanoutSeen.set(id, snap.dbNow);
        progress = true;
        const name = String(row.signal);
        liveSignals.add(name);
        const handlers = liveHandlers.get(name);
        const payload = JSON.parse(String(row.payload));
        if (handlers) {
          const event: LiveEvent = { id, payload };
          for (const h of handlers) await h(event);
        }
        let list = recentLive.get(name);
        if (!list) {
          list = [];
          recentLive.set(name, list);
        }
        list.push(payload);
        while (list.length > 50) list.shift();
        noteDelivered();
      }
    }
    const pruneBefore = snap.dbNow - lagMs;
    for (const [id, seenAt] of fanoutSeen) {
      if (seenAt < pruneBefore) fanoutSeen.delete(id);
    }
    fanoutCursor = snap.dbNow;
    await sql.exec(BROADCAST_TTL_DELETE_SQL, [snap.dbNow - broadcastTtlMs]);
    for (const name of liveSignals) {
      await pruneLive(name);
    }
    return progress;
  }

  async function drain(): Promise<void> {
    if (draining) {
      await draining;
      return;
    }
    draining = (async () => {
      for (let i = 0; i < 1000; i++) {
        const a = await drainOncePass();
        const b = await drainFanoutPass();
        if (!a && !b) break;
      }
    })();
    try {
      await draining;
    } finally {
      draining = null;
    }
  }

  async function deadLetters(signal: string): Promise<readonly DeadLetter[]> {
    const rows = await sql.query(
      `SELECT * FROM oke_signal_messages WHERE signal = ? AND status = ?`,
      [signal, "dead"],
    );
    return rows.map((r) => ({ ...rowToMessage(r), status: "dead" as const }));
  }

  async function statsFor(name: string): Promise<SignalStats | null> {
    const decl = signals.get(name);
    if (!decl) return null;
    const rows = await sql.query(`SELECT * FROM oke_signal_messages WHERE signal = ?`, [name]);
    let pending = 0;
    let inflight = 0;
    let dead = 0;
    let delivered = 0;
    let oldestPending: number | null = null;
    const deadList: DeadLetter[] = [];
    for (const row of rows) {
      const status = String(row.status);
      if (status === "pending") {
        pending += 1;
        const created = Number(row.created_at);
        if (oldestPending === null || created < oldestPending) {
          oldestPending = created;
        }
      } else if (status === "inflight") {
        inflight += 1;
        const created = Number(row.created_at);
        if (oldestPending === null || created < oldestPending) {
          oldestPending = created;
        }
      } else if (status === "dead") {
        dead += 1;
        deadList.push({ ...rowToMessage(row), status: "dead" });
      } else if (status === "delivered") {
        delivered += 1;
      }
    }
    const subs = consumers.filter((c) => c.signal === name);
    const subscribers = subs.map((c) => {
      let lag = 0;
      for (const row of rows) {
        if (row.delivery !== "broadcast") continue;
        if (row.status === "dead") continue;
        if (fanoutSeen.has(String(row.id))) continue;
        lag += 1;
      }
      return {
        id: c.subscriberId,
        lag,
        errorCount: subscriberErrors.get(`${name}::${c.subscriberId}`) ?? 0,
      };
    });
    return {
      signal: name,
      delivery: decl.delivery,
      pending,
      inflight,
      dead,
      delivered,
      retries: decl.retries,
      deadLetterEnabled: decl.deadLetter,
      outboxLagMs: oldestPending === null ? null : Math.max(0, now() - oldestPending),
      subscribers,
      connections: liveHandlers.get(name)?.size ?? 0,
      throughputPerSec: throughputPerSec(),
      schema: decl.schema,
      recentLive: [...(recentLive.get(name) ?? [])],
      deadLetters: deadList,
    };
  }

  async function inspect(signal?: string): Promise<readonly SignalStats[]> {
    if (signal) {
      const one = await statsFor(signal);
      return one ? [one] : [];
    }
    const out: SignalStats[] = [];
    for (const name of signals.keys()) {
      const s = await statsFor(name);
      if (s) out.push(s);
    }
    return out;
  }

  async function replay(options: SignalReplayOptions): Promise<SignalReplayResult> {
    requireDecl(options.signal);
    const rate = Math.max(1, options.ratePerSec);
    const intervalMs = Math.floor(1_000 / rate);
    const dead = await deadLetters(options.signal);
    const ids =
      options.messageIds && options.messageIds.length > 0 ? new Set(options.messageIds) : null;
    const targets = dead.filter((m) => ids === null || ids.has(m.id));
    const results: SignalReplayResult["results"][number][] = [];
    const wouldHaveFired: SignalReplayResult["wouldHaveFired"][number][] = [];
    let succeeded = 0;
    let failed = 0;

    for (let i = 0; i < targets.length; i++) {
      if (i > 0 && intervalMs > 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
      }
      const m = targets[i]!;
      const payload = options.payloads?.[m.id] !== undefined ? options.payloads[m.id] : m.payload;
      if (options.payloads?.[m.id] !== undefined && !options.dryRun) {
        await sql.exec(`UPDATE oke_signal_messages SET payload = ? WHERE id = ?`, [
          JSON.stringify(payload),
          m.id,
        ]);
      }

      const handlers = consumers.filter((c) => {
        if (c.signal !== m.signal) return false;
        if (options.subscriberId) return c.subscriberId === options.subscriberId;
        return true;
      });

      if (handlers.length === 0) {
        results.push({
          id: m.id,
          ok: false,
          error: {
            code: "no_consumer",
            message: "No consumer registered for replay",
          },
        });
        failed += 1;
        continue;
      }

      let ok = true;
      let lastErr: { code: string; message: string } | undefined;
      for (const h of handlers) {
        try {
          const msg = { ...m, payload };
          if (options.dryRun) {
            const stubbed = await withDryRun(async () => {
              setDryRunMessageId(m.id);
              await h.handler(msg);
            });
            for (const w of stubbed.wouldHaveFired) {
              wouldHaveFired.push({
                kind: w.kind,
                resource: w.resource,
                messageId: w.messageId ?? m.id,
              });
            }
          } else {
            await h.handler(msg);
          }
        } catch (err) {
          if (options.dryRun && err instanceof DryRunWriteIsolationError) {
            return {
              attempted: 0,
              succeeded: 0,
              failed: 0,
              dryRun: true,
              results: [],
              wouldHaveFired: [],
              refused: {
                code: "dry_run_unsafe",
                reason: err.message,
              },
            };
          }
          ok = false;
          const reason = failureFromError(err, m.attempts + 1);
          lastErr = { code: reason.code, message: reason.message };
          if (!options.dryRun) {
            const failures = [...m.failures, reason];
            await sql.exec(`UPDATE oke_signal_messages SET failures = ? WHERE id = ?`, [
              JSON.stringify(failures),
              m.id,
            ]);
          }
        }
      }

      if (ok) {
        succeeded += 1;
        results.push({ id: m.id, ok: true });
        if (!options.dryRun) {
          if (options.subscriberId && m.delivery === "broadcast") {
            const row = (
              await sql.query(`SELECT * FROM oke_signal_messages WHERE id = ?`, [m.id])
            )[0];
            const deliveredTo = new Set(JSON.parse(String(row?.delivered_to ?? "[]")) as string[]);
            deliveredTo.delete(options.subscriberId);
            await sql.exec(
              `UPDATE oke_signal_messages SET status = 'pending', locked_by = NULL, lease_expires_at = NULL, attempts = 0, available_at = ?, delivered_to = ? WHERE id = ?`,
              [now(), JSON.stringify([...deliveredTo]), m.id],
            );
          } else {
            await sql.exec(
              `UPDATE oke_signal_messages SET status = 'pending', locked_by = NULL, lease_expires_at = NULL, attempts = 0, available_at = ?, delivered_to = '[]' WHERE id = ?`,
              [now(), m.id],
            );
          }
        }
      } else {
        failed += 1;
        results.push({ id: m.id, ok: false, error: lastErr });
      }
    }

    return {
      attempted: targets.length,
      succeeded,
      failed,
      dryRun: options.dryRun,
      results,
      wouldHaveFired,
    };
  }

  async function discard(options: SignalDiscardOptions): Promise<{ readonly discarded: number }> {
    let discarded = 0;
    for (const id of options.messageIds) {
      const result = await sql.exec(
        `DELETE FROM oke_signal_messages WHERE id = ? AND signal = ? AND status = 'dead'`,
        [id, options.signal],
      );
      discarded += result.changes;
    }
    return { discarded };
  }

  async function getWrite(key: string): Promise<unknown> {
    const rows = await sql.query(`SELECT value FROM oke_signal_writes WHERE key = ?`, [key]);
    if (!rows[0]) return undefined;
    return JSON.parse(String(rows[0].value));
  }

  const bus: SignalBus & {
    emitInTransaction: typeof emitInTransaction;
    sql: PostgresSignalSql;
  } = {
    driverId: "postgres",
    emit,
    begin,
    subscribe,
    live,
    checkLiveResume,
    drain,
    deadLetters,
    inspect,
    replay,
    discard,
    getWrite,
    async close() {
      unlisten?.();
      await sql.close();
    },
    emitInTransaction,
    sql,
  };

  return bus;
}

/** Protocol-named postgres signal driver. */
export const postgresSignalDriver: SignalDriver = {
  id: "postgres",
  open: openPostgresSignal,
};
