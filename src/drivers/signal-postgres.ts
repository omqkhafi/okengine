/**
 * `postgres` signal driver — transactional emit (dual-write fix).
 *
 * `fx.emit` inserts into the outbox on the caller's connection. Consumers
 * claim with `FOR UPDATE SKIP LOCKED`; wakeups use `LISTEN` / `NOTIFY`.
 */

import type { SignalDecl } from "../elements/signal/declare.ts";
import type { SignalDelivery } from "../manifest/types.ts";
import { DryRunWriteIsolationError, setDryRunMessageId, withDryRun } from "../kernel/dry-run.ts";
import { OkeError, OKE_ERRORS } from "../kernel/errors.ts";
import {
  SIGNAL_DEFAULT_LEASE_MS,
  validateSignalEmitPayload,
  type DeadLetter,
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
} from "./signal-types.ts";

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
   *
   * @param channel - Channel name
   * @param onNotify - Payload callback
   */
  listen(channel: string, onNotify: (payload: string) => void): Promise<() => void>;
  /**
   * NOTIFY channel.
   *
   * @param channel - Channel name
   * @param payload - Payload
   */
  notify(channel: string, payload: string): Promise<void>;
  close(): Promise<void>;
}

const CHANNEL = "oke_signal";

/** Claim next once-row: pending/unlocked or lease-expired, blocked by same-key inflight. */
const CLAIM_ONCE_SQL = `SELECT * FROM oke_signal_messages WHERE signal=? AND delivery='once' AND available_at<=? AND ((status='pending' AND locked_by IS NULL) OR (status='inflight' AND lease_expires_at IS NOT NULL AND lease_expires_at<=?)) AND (ordering_key IS NULL OR NOT EXISTS (SELECT 1 FROM oke_signal_messages h WHERE h.signal=oke_signal_messages.signal AND h.ordering_key=oke_signal_messages.ordering_key AND h.id<>oke_signal_messages.id AND h.status='inflight' AND h.lease_expires_at IS NOT NULL AND h.lease_expires_at>?)) ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED`;

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
      const isOnceClaim =
        /FOR\s+UPDATE\s+SKIP\s+LOCKED/i.test(text) &&
        /oke_signal_messages/i.test(text) &&
        /delivery\s*=\s*'once'/i.test(text);
      if (isOnceClaim) {
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
        return [{ ...row }];
      }

      const selMsg =
        /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+signal\s*=\s*\?\s+AND\s+status\s*=\s*\?\s*$/i.exec(
          text,
        );
      if (selMsg) {
        return state.messages
          .filter((m) => m.signal === params[0] && m.status === params[1])
          .map((m) => ({ ...m }));
      }

      const selPending =
        /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+status\s+IN\s*\('pending',\s*'inflight'\)\s*$/i.exec(
          text,
        );
      if (selPending) {
        return state.messages
          .filter((m) => m.status === "pending" || m.status === "inflight")
          .map((m) => ({ ...m }));
      }

      const selAll =
        /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+signal\s*=\s*\?\s*$/i.exec(text);
      if (selAll) {
        return state.messages.filter((m) => m.signal === params[0]).map((m) => ({ ...m }));
      }

      const selWrite =
        /^SELECT\s+value\s+FROM\s+oke_signal_writes\s+WHERE\s+key\s*=\s*\?\s*$/i.exec(text);
      if (selWrite) {
        const v = state.writes.get(String(params[0]));
        if (v === undefined) return [];
        return [{ value: JSON.stringify(v) }];
      }

      const byId = /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+id\s*=\s*\?\s*$/i.exec(
        text,
      );
      if (byId) {
        return state.messages.filter((m) => m.id === params[0]).map((m) => ({ ...m }));
      }

      const selLive =
        /^SELECT\s+\*\s+FROM\s+oke_signal_messages\s+WHERE\s+signal\s*=\s*\?\s+AND\s+delivery\s*=\s*'live'\s+ORDER\s+BY\s+created_at\s+ASC\s*$/i.exec(
          text,
        );
      if (selLive) {
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

      if (/^CREATE\s+TABLE/i.test(text)) return { changes: 0 };

      const delDead =
        /^DELETE\s+FROM\s+oke_signal_messages\s+WHERE\s+id\s*=\s*\?\s+AND\s+signal\s*=\s*\?\s+AND\s+status\s*=\s*'dead'\s*$/i.exec(
          text,
        );
      if (delDead) {
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

      const insertMsg =
        /^INSERT\s+INTO\s+oke_signal_messages\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)\s*$/i.exec(text);
      if (insertMsg) {
        const cols = insertMsg[1]!.split(",").map((c) => c.trim());
        const row: Record<string, unknown> = {};
        cols.forEach((c, i) => {
          row[c] = params[i];
        });
        state.messages.push({
          id: String(row.id),
          signal: String(row.signal),
          payload: String(row.payload),
          ordering_key:
            row.ordering_key === undefined || row.ordering_key === null
              ? null
              : String(row.ordering_key),
          delivery: row.delivery as SignalDelivery,
          attempts: Number(row.attempts ?? 0),
          failures: String(row.failures ?? "[]"),
          created_at: Number(row.created_at),
          available_at: Number(row.available_at),
          status: (row.status as MsgRow["status"]) ?? "pending",
          locked_by: (row.locked_by as string | null) ?? null,
          lease_expires_at:
            row.lease_expires_at === undefined || row.lease_expires_at === null
              ? null
              : Number(row.lease_expires_at),
          delivered_to: String(row.delivered_to ?? "[]"),
        });
        return { changes: 1 };
      }

      const insertWrite =
        /^INSERT\s+INTO\s+oke_signal_writes\s*\(key,\s*value\)\s*VALUES\s*\(\?,\s*\?\)\s*$/i.exec(
          text,
        );
      if (insertWrite) {
        state.writes.set(String(params[0]), JSON.parse(String(params[1])));
        return { changes: 1 };
      }

      const upd = /^UPDATE\s+oke_signal_messages\s+SET\s+(.+)\s+WHERE\s+id\s*=\s*\?\s*$/i.exec(
        text,
      );
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

      if (/^ALTER\s+TABLE\s+oke_signal_messages\s+ADD\s+COLUMN/i.test(text)) {
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
    delivered_to TEXT
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
  await sql.exec(`CREATE TABLE IF NOT EXISTS oke_signal_writes (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);
}

function rowToMessage(row: Record<string, unknown>): SignalMessage {
  const key =
    row.ordering_key === undefined || row.ordering_key === null || row.ordering_key === ""
      ? undefined
      : String(row.ordering_key);
  return {
    id: String(row.id),
    signal: String(row.signal),
    payload: JSON.parse(String(row.payload)),
    ...(key !== undefined ? { key } : {}),
    delivery: row.delivery as SignalDelivery,
    attempts: Number(row.attempts),
    failures: JSON.parse(String(row.failures ?? "[]")) as SignalFailureReason[],
    createdAt: Number(row.created_at),
    availableAt: Number(row.available_at),
    status: row.status as SignalMessage["status"],
  };
}

/**
 * Open a postgres-backed signal bus.
 *
 * @param options - Declarations / sql fake / clock
 */
export async function openPostgresSignal(options: SignalOpenOptions): Promise<SignalBus> {
  const now = options.now ?? (() => Date.now());
  const signals = options.signals;
  const leaseMs = options.leaseMs ?? SIGNAL_DEFAULT_LEASE_MS;
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

  unlisten = await sql.listen(CHANNEL, () => {
    void drainQuiet();
  });

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
    await tx.exec(
      `INSERT INTO oke_signal_messages (id, signal, payload, ordering_key, delivery, attempts, failures, created_at, available_at, status, locked_by, lease_expires_at, delivered_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        crypto.randomUUID(),
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
      ],
    );
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
        await sql.notify(CHANNEL, "commit");
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

  async function live(signal: string, handler: LiveHandler): Promise<SignalUnsubscribe> {
    const decl = requireDecl(signal);
    if (decl.delivery !== "live") {
      throw new Error(`signal "${signal}" is not delivery: "live"`);
    }
    let set = liveHandlers.get(signal);
    if (!set) {
      set = new Set();
      liveHandlers.set(signal, set);
    }
    set.add(handler);
    const history = await sql.query(
      `SELECT * FROM oke_signal_messages WHERE signal = ? AND delivery = 'live' ORDER BY created_at ASC`,
      [signal],
    );
    for (const row of history) {
      await handler(JSON.parse(String(row.payload)));
    }
    return () => {
      set!.delete(handler);
    };
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
      const claimed = await sql.query(CLAIM_ONCE_SQL, [consumer.signal, t, t, t]);
      if (claimed[0]) {
        progress = true;
        const row = claimed[0];
        const attempts = Number(row.attempts) + 1;
        const leaseExpiresAt = t + leaseMs;
        await sql.exec(
          `UPDATE oke_signal_messages SET status = 'inflight', locked_by = ?, attempts = ?, lease_expires_at = ? WHERE id = ?`,
          [consumer.subscriberId, attempts, leaseExpiresAt, row.id],
        );
        row.locked_by = consumer.subscriberId;
        row.attempts = attempts;
        row.status = "inflight";
        row.lease_expires_at = leaseExpiresAt;
        await deliverOnce(row, consumer);
      }
    }
    return progress;
  }

  async function drainBroadcastPass(): Promise<boolean> {
    let progress = false;
    for (const consumer of consumers) {
      const decl = signals.get(consumer.signal);
      if (decl?.delivery !== "broadcast") continue;
      const rows = await sql.query(`SELECT * FROM oke_signal_messages WHERE signal = ?`, [
        consumer.signal,
      ]);
      for (const row of rows) {
        if (row.status === "dead" || row.status === "delivered") continue;
        if (row.delivery !== "broadcast") continue;
        // Re-read delivered_to so concurrent drain (NOTIFY) cannot double-deliver.
        const fresh = await sql.query(`SELECT * FROM oke_signal_messages WHERE signal = ?`, [
          consumer.signal,
        ]);
        const current = fresh.find((r) => r.id === row.id);
        if (!current || current.status === "delivered") continue;
        const deliveredTo = new Set(JSON.parse(String(current.delivered_to ?? "[]")) as string[]);
        if (deliveredTo.has(consumer.subscriberId)) continue;
        // Claim this subscriber slot before invoking the handler.
        deliveredTo.add(consumer.subscriberId);
        const subs = consumers.filter((c) => c.signal === consumer.signal);
        const status = subs.every((s) => deliveredTo.has(s.subscriberId)) ? "delivered" : "pending";
        await sql.exec(
          `UPDATE oke_signal_messages SET delivered_to = ?, status = ?, attempts = ? WHERE id = ?`,
          [JSON.stringify([...deliveredTo]), status, Number(current.attempts) + 1, row.id],
        );
        progress = true;
        const msg = rowToMessage(current);
        try {
          await consumer.handler(msg);
          noteDelivered();
        } catch (err) {
          const failures = [...msg.failures, failureFromError(err, Number(current.attempts) + 1)];
          const key = `${consumer.signal}::${consumer.subscriberId}`;
          subscriberErrors.set(key, (subscriberErrors.get(key) ?? 0) + 1);
          await sql.exec(`UPDATE oke_signal_messages SET failures = ? WHERE id = ?`, [
            JSON.stringify(failures),
            row.id,
          ]);
        }
      }
    }
    return progress;
  }

  async function drainLivePass(): Promise<boolean> {
    let progress = false;
    const pending = await sql.query(
      `SELECT * FROM oke_signal_messages WHERE status IN ('pending', 'inflight')`,
    );
    for (const row of pending) {
      if (row.delivery !== "live") continue;
      progress = true;
      const handlers = liveHandlers.get(String(row.signal));
      const payload = JSON.parse(String(row.payload));
      if (handlers) {
        for (const h of handlers) await h(payload);
      }
      const sig = String(row.signal);
      let list = recentLive.get(sig);
      if (!list) {
        list = [];
        recentLive.set(sig, list);
      }
      list.push(payload);
      while (list.length > 50) list.shift();
      noteDelivered();
      await sql.exec(
        `UPDATE oke_signal_messages SET status = 'delivered', locked_by = NULL, lease_expires_at = NULL WHERE id = ?`,
        [row.id],
      );
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
        const b = await drainBroadcastPass();
        const c = await drainLivePass();
        if (!a && !b && !c) break;
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
    const subscribers = await Promise.all(
      subs.map(async (c) => {
        let lag = 0;
        for (const row of rows) {
          if (row.delivery !== "broadcast") continue;
          if (row.status === "dead" || row.status === "delivered") continue;
          const deliveredTo = new Set(JSON.parse(String(row.delivered_to ?? "[]")) as string[]);
          if (!deliveredTo.has(c.subscriberId)) lag += 1;
        }
        return {
          id: c.subscriberId,
          lag,
          errorCount: subscriberErrors.get(`${name}::${c.subscriberId}`) ?? 0,
        };
      }),
    );
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
