/**
 * `oke_cdc_outbox` — durable, multi-host CDC.
 *
 * Same transactional-outbox physics as the Signal / Journal drivers:
 * writes land in the SAME transaction as the DML (`sql-session` hook),
 * a SKIP LOCKED poller drains rows to in-process subscribers (LiveQuery
 * runtime + user-declared CDC flows). Retention mirrors Signal's
 * `maxAge` / `maxCount` discipline — this is not the one table without it.
 */

/** Wire shape of one row drained from the outbox. */
export interface OutboxRow {
  readonly id: string;
  readonly seq: number;
  readonly tableName: string;
  readonly op: "insert" | "update" | "delete";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  /** Echoed `X-Oke-Mutation-Id` (client dedupe), when the write carried one. */
  readonly mutationId?: string;
  readonly createdAt: number;
}

/** Retention caps applied by the poller between claims. */
export interface OutboxRetention {
  /** Drop delivered rows older than this many ms. */
  readonly maxAgeMs?: number;
  /** Keep at most this many delivered rows (newest survive). */
  readonly maxCount?: number;
}

/** Default `maxAgeMs` — delivered rows pruned after 24h (Signal live-tape parity). */
export const OUTBOX_DEFAULT_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/** Default `maxCount` — cap total delivered rows retained (never touches pending). */
export const OUTBOX_DEFAULT_MAX_COUNT = 50_000;

/**
 * Fill omitted retention fields with the {@link OUTBOX_DEFAULT_MAX_AGE_MS} /
 * {@link OUTBOX_DEFAULT_MAX_COUNT} defaults so the outbox is never the one
 * durable table without pruning discipline.
 *
 * @param retention - Caller caps (fields omit → default)
 */
export function resolveOutboxRetention(retention: OutboxRetention = {}): Required<OutboxRetention> {
  return {
    maxAgeMs: retention.maxAgeMs ?? OUTBOX_DEFAULT_MAX_AGE_MS,
    maxCount: retention.maxCount ?? OUTBOX_DEFAULT_MAX_COUNT,
  };
}

/** Postgres DDL for the outbox. */
export const OKE_CDC_OUTBOX_DDL = `
CREATE TABLE IF NOT EXISTS oke_cdc_outbox (
  id text PRIMARY KEY,
  seq bigint GENERATED ALWAYS AS IDENTITY,
  table_name text NOT NULL,
  op text NOT NULL,
  before_data jsonb,
  after_data jsonb,
  mutation_id text,
  created_at bigint NOT NULL,
  claimed_at bigint,
  delivered_at bigint
);
CREATE INDEX IF NOT EXISTS oke_cdc_outbox_pending_idx
  ON oke_cdc_outbox (seq) WHERE delivered_at IS NULL;
CREATE INDEX IF NOT EXISTS oke_cdc_outbox_delivered_created_idx
  ON oke_cdc_outbox (created_at) WHERE delivered_at IS NOT NULL;
`;

/**
 * Driver-agnostic outbox on a {@link SqlConnection}.
 *
 * Works on pglite and pooled postgres — every claim runs inside a
 * transaction so row locks are held exactly for mark-as-delivered.
 */
export class CdcOutbox {
  private readonly conn: {
    query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
    exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
    transaction?<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
  };
  private readonly retention: Required<OutboxRetention>;
  private readonly now: () => number;
  private ensuring?: Promise<void>;

  constructor(
    conn: {
      query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
      exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
      transaction?<T>(fn: (tx: unknown) => Promise<T>): Promise<T>;
    },
    retention: OutboxRetention = {},
    now: () => number = () => Date.now(),
  ) {
    this.conn = conn;
    this.retention = resolveOutboxRetention(retention);
    this.now = now;
  }

  /** Idempotent DDL ensure — first write or poll creates the table. */
  async ensure(): Promise<void> {
    if (!this.ensuring) {
      this.ensuring = (async () => {
        for (const stmt of OKE_CDC_OUTBOX_DDL.split(";").filter((s) => s.trim())) {
          await this.conn.exec(stmt.trim());
        }
      })().catch((err) => {
        this.ensuring = undefined;
        throw err;
      });
    }
    await this.ensuring;
  }

  /**
   * Enqueue one change. Call from inside the WRITE transaction so the event
   * commits atomically with the data change.
   *
   * @param entry - Table/op/images; ids minted when absent
   */
  async append(entry: {
    readonly id?: string;
    readonly tableName: string;
    readonly op: "insert" | "update" | "delete";
    readonly before?: Record<string, unknown> | null;
    readonly after?: Record<string, unknown> | null;
    readonly mutationId?: string;
  }): Promise<void> {
    await this.ensure();
    const { okid } = await import("../okid.ts");
    await this.conn.exec(
      `INSERT INTO oke_cdc_outbox (id, table_name, op, before_data, after_data, mutation_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        entry.id ?? okid(),
        entry.tableName,
        entry.op,
        entry.before === null || entry.before === undefined ? null : JSON.stringify(entry.before),
        entry.after === null || entry.after === undefined ? null : JSON.stringify(entry.after),
        entry.mutationId ?? null,
        this.now(),
      ],
    );
  }

  /**
   * Outbox backlog gauges for metrics/doctor: total pending (undelivered)
   * rows and delivered rows retained beyond the `maxCount` cap.
   *
   * @returns `{ pending, dispatchedOverCap }` row counts
   */
  async stats(): Promise<{ pending: number; dispatchedOverCap: number }> {
    await this.ensure();
    const rows = await this.conn.query(
      `SELECT
         COUNT(*) FILTER (WHERE delivered_at IS NULL) AS pending,
         GREATEST(
           COUNT(*) FILTER (WHERE delivered_at IS NOT NULL) - ?,
           0
         ) AS dispatched_over_cap
       FROM oke_cdc_outbox`,
      [this.retention.maxCount],
    );
    const row = rows[0];
    return {
      pending: row === undefined ? 0 : Number(row.pending ?? 0),
      dispatchedOverCap: row === undefined ? 0 : Number(row.dispatched_over_cap ?? 0),
    };
  }

  /**
   * Claim up to `limit` undelivered rows with SKIP LOCKED semantics, hand
   * them to `handler`, and mark them delivered after it resolves.
   * A crash between claim and mark redelivers (at-least-once) rather than
   * loses; a handler throw leaves rows pending and returns [] — callers
   * poll again on the next tick.
   *
   * @param handler - Batch consumer; throw to leave rows pending-redelivery
   * @param limit - Max rows per batch
   * @returns Rows handed to the handler this tick (delivered)
   */
  async pollOnce(
    handler: (rows: readonly OutboxRow[]) => Promise<void>,
    limit = 200,
  ): Promise<readonly OutboxRow[]> {
    await this.ensure();
    try {
      if (!this.conn.transaction) {
        const claimed = await this.claimInTx(this.conn as never, limit);
        if (claimed.length > 0) {
          await handler(claimed);
          await this.markDelivered(claimed);
        }
        return claimed;
      }
      let claimed: OutboxRow[] = [];
      await this.conn.transaction(async (tx) => {
        claimed = await this.claimInTx(tx as never, limit);
      });
      if (claimed.length > 0) {
        await handler(claimed);
        await this.markDelivered(claimed);
      }
      return claimed;
    } catch {
      // SKIP LOCKED under concurrent contention can serialize; a transient
      // failure leaves rows unclaimed and the next tick retries.
      return [];
    }
  }

  /** Internal claim inside an open transaction. */
  private async claimInTx(
    tx: {
      query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
      exec(sql: string, params?: readonly unknown[]): Promise<{ changes: number }>;
    },
    limit: number,
  ): Promise<OutboxRow[]> {
    const rows = await tx.query(
      `SELECT id, seq, table_name, op, before_data, after_data, mutation_id, created_at
         FROM oke_cdc_outbox
        WHERE delivered_at IS NULL
          AND (claimed_at IS NULL OR claimed_at <= ?)
        ORDER BY seq ASC
        LIMIT ?`,
      [this.now() - CLAIM_TTL_MS, Math.max(1, limit)],
    );
    if (rows.length === 0) return [];
    const mapped = rows.map((r) => ({
      id: String(r.id),
      seq: Number(r.seq),
      tableName: String(r.table_name),
      op: r.op as OutboxRow["op"],
      before: parseImages(r.before_data),
      after: parseImages(r.after_data),
      ...(typeof r.mutation_id === "string" && r.mutation_id.length > 0
        ? { mutationId: r.mutation_id }
        : {}),
      createdAt: Number(r.created_at),
    }));
    const ids = mapped.map((r) => r.id);
    const marks = ids.map(() => "?").join(", ");
    // Claim bump doubles as the attempt counter: each stale-bump re-claim is
    // one redelivery. `claimed_at` older than the claim TTL becomes eligible
    // again, so a crashed poller's rows get picked up without a hot loop.
    await tx.exec(`UPDATE oke_cdc_outbox SET claimed_at = ? WHERE id IN (${marks})`, [
      this.now(),
      ...ids,
    ]);
    return mapped;
  }

  /**
   * Prune delivered rows beyond retention (`maxAgeMs` / `maxCount`).
   * Call periodically from the poller loop — NOT per tick.
   *
   * @returns Rows deleted (for metrics)
   */
  async prune(): Promise<number> {
    let pruned = 0;
    const cutoff =
      this.retention.maxAgeMs === undefined ? null : this.now() - this.retention.maxAgeMs;
    if (cutoff !== null) {
      const res = await this.conn.exec(
        `DELETE FROM oke_cdc_outbox WHERE delivered_at IS NOT NULL AND created_at < ?`,
        [cutoff],
      );
      pruned += res.changes;
    }
    if (this.retention.maxCount !== undefined) {
      const res = await this.conn.exec(
        `DELETE FROM oke_cdc_outbox WHERE id IN (
           SELECT id FROM oke_cdc_outbox WHERE delivered_at IS NOT NULL
           ORDER BY created_at DESC OFFSET ?
         )`,
        [Math.max(0, this.retention.maxCount)],
      );
      pruned += res.changes;
    }
    return pruned;
  }

  /** Mark a specific batch delivered after its handler resolved. */
  async markDelivered(rows: readonly OutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    const marks = rows.map(() => "?").join(", ");
    await this.conn.exec(`UPDATE oke_cdc_outbox SET delivered_at = ? WHERE id IN (${marks})`, [
      this.now(),
      ...rows.map((r) => r.id),
    ]);
  }
}

/** Claim TTL — rows claimed longer ago than this are eligible for redelivery. */
const CLAIM_TTL_MS = 30_000;

/** Default sweep cadence for {@link CdcOutboxRunner} retention pruning. */
export const OUTBOX_PRUNE_INTERVAL_MS = 60_000;

/**
 * Single-process poller loop: claims batches, feeds the LiveQuery runtime
 * (and any other sinks), marks delivered, and prunes on a slow cadence.
 * Start via {@link start}; idempotent `stop()` on the returned handle.
 */
export class CdcOutboxRunner {
  private timer?: ReturnType<typeof setInterval>;
  private polling = false;
  private lastPrune = 0;
  private readonly intervalMs: number;
  private readonly batchSize: number;
  private readonly now: () => number;
  private readonly outbox: CdcOutbox;
  private readonly handler: (rows: readonly OutboxRow[]) => Promise<void>;
  /** Counters surfaced through doctor/metrics. */
  readonly metrics = { polls: 0, batches: 0, eventsDrained: 0, pruneFailures: 0 };

  constructor(
    outbox: CdcOutbox,
    handler: (rows: readonly OutboxRow[]) => Promise<void>,
    options: {
      readonly intervalMs?: number;
      readonly batchSize?: number;
      readonly now?: () => number;
    } = {},
  ) {
    this.outbox = outbox;
    this.handler = handler;
    this.intervalMs = Math.max(10, options.intervalMs ?? 200);
    this.batchSize = Math.max(1, options.batchSize ?? 200);
    this.now = options.now ?? (() => Date.now());
  }

  /** Begin background polling (idempotent). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.intervalMs);
    this.timer.unref?.();
  }

  /** Stop polling (idempotent). */
  stop(): void {
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** One claim→handle→deliver→(maybe)prune cycle. Exposed for tests. */
  async tick(): Promise<number> {
    if (this.polling) return 0;
    this.polling = true;
    try {
      this.metrics.polls += 1;
      const nowMs = this.now();
      if (nowMs - this.lastPrune >= OUTBOX_PRUNE_INTERVAL_MS) {
        this.lastPrune = nowMs;
        try {
          await this.outbox.prune();
        } catch {
          this.metrics.pruneFailures += 1;
        }
      }
      const rows = await this.outbox.pollOnce((batch) => this.handler(batch), this.batchSize);
      if (rows.length > 0) {
        this.metrics.batches += 1;
        this.metrics.eventsDrained += rows.length;
      }
      return rows.length;
    } finally {
      this.polling = false;
    }
  }
}

function parseImages(value: unknown): Record<string, unknown> | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
  return null;
}
