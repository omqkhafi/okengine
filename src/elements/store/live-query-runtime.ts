/**
 * LiveQuery runtime — the Realtime round's core (Phase 2).
 *
 * Responsibilities:
 * - Subscription registry: fixed-size per-connection Map (no server-side
 *   row-set tracking — classification is stateless, from CDC images only).
 * - Fan-out: bounded worker pool (architecture contract). Concurrency and
 *   queue depth caps shed with explicit `liveFanoutShed` metrics instead of
 *   unbounded queueing.
 * - Classification per subscriber, per event:
 *     after === null                          → delete | ignore
 *     stamped EXISTS(after) true              → upsert
 *     beforeVisible replay true               → revoked(reason "rls"|"query")
 *     pk in subscriber's last snapshot set?   → revoked : ignore
 *
 * The visibility probes run through the SAME stamped identity production
 * uses (`RlsIdentity` prelude), so RLS is Postgres-authoritative for both
 * read and live paths. `beforeVisible` replays native policy expressions via
 * `oke.row_passes_policies` against the before-image JSONB — no heap access,
 * zero persistent per-subscription state.
 */

import { rlsScopesJson, type RlsIdentity } from "../../drivers/pg-rls.ts";

/** Public wire taxonomy — `revoked.reason` is protocol, not internal. */
export type LiveQueryEvent =
  | {
      readonly kind: "upsert";
      readonly row: Record<string, unknown>;
      readonly seq?: number;
      readonly mutationId?: string;
    }
  | { readonly kind: "revoked"; readonly id: string; readonly reason: "rls" | "query" }
  | { readonly kind: "delete"; readonly id: string };

/** One subscriber's identity + query shape. */
export interface LiveSubscription {
  /** Stable id (SSE session). */
  readonly id: string;
  /** `sql:` resource ref. */
  readonly ref: `sql:${string}`;
  /** Physical table name. */
  readonly table: string;
  /** Primary key column (compiler guardrail requires it for `live: true`). */
  readonly pkColumn: string;
  /**
   * Column type hints (`jsName → primitive kind`) used to restore JSONB
   * round-tripped images (outbox rows) to their declared shapes. Optional —
   * tests and schema-less subscriptions omit it.
   */
  readonly tableColumns?: Readonly<Record<string, "string" | "number" | "boolean">>;
  /** Subscriber stamp (gate/user/scopes/tenant) — re-stamped per probe. */
  readonly identity: RlsIdentity;
  /**
   * Query-window filter (list `where`, compiled SQL clause + params under
   * `?` placeholders). Empty = whole table within RLS.
   */
  readonly whereSql?: string;
  readonly whereParams?: readonly unknown[];
  /** Target for classified events. */
  deliver(event: LiveQueryEvent): void;
}

/**
 * Probe executor — abstracted so tests inject fakes while prod uses a real
 * pooled {@link SqlConnection}.
 */
export interface LiveProbeRunner {
  /**
   * Run `fn` with the subscription's identity stamped on one backend
   * session (`SET LOCAL ROLE oke_app` + GUC prelude in prod).
   */
  runStamped<T>(identity: RlsIdentity, fn: (exec: LiveProbeExec) => Promise<T>): Promise<T>;
}

/** Statement surface available inside one stamped frame. */
export interface LiveProbeExec {
  query(sql: string, params?: readonly unknown[]): Promise<Record<string, unknown>[]>;
}

/** Fan-out pool knobs (architecture contract — never implicit/unbounded). */
export interface FanoutPoolOptions {
  /** Max concurrent classification jobs (default 32). */
  concurrency?: number;
  /** Max queued events; excess sheds immediately (default 10_000). */
  maxQueue?: number;
}

interface QueueItem {
  readonly event: CdcEventInput;
  readonly subscribers: readonly LiveSubscription[];
}

/** One CDC change entering the runtime. */
export interface CdcEventInput {
  readonly tableName: string;
  readonly op: "insert" | "update" | "delete";
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly seq?: number;
  /** Echoed from mutation headers so clients can dedupe their own writes. */
  readonly mutationId?: string;
}

export class LiveQueryRuntime {
  private readonly subs = new Map<string, LiveSubscription>();
  private readonly byTable = new Map<string, Set<string>>();
  private readonly queue: QueueItem[] = [];
  private active = 0;
  private draining = false;
  private readonly probes: LiveProbeRunner;
  private readonly concurrency: number;
  private readonly maxQueue: number;
  /** Counters surfaced through doctor/metrics. */
  readonly metrics = { eventsIn: 0, eventsShed: 0, checksRun: 0, checkFailures: 0 };

  constructor(probes: LiveProbeRunner, options: FanoutPoolOptions = {}) {
    this.probes = probes;
    this.concurrency = Math.max(1, options.concurrency ?? 32);
    this.maxQueue = Math.max(1, options.maxQueue ?? 10_000);
  }

  /**
   * Register a subscriber. Returns an unsubscriber.
   *
   * @param sub - Identity + query window + delivery sink
   */
  subscribe(sub: LiveSubscription): () => void {
    this.subs.set(sub.id, sub);
    let ids = this.byTable.get(sub.table);
    if (!ids) {
      ids = new Set();
      this.byTable.set(sub.table, ids);
    }
    ids.add(sub.id);
    return () => {
      this.subs.delete(sub.id);
      const set = this.byTable.get(sub.table);
      if (set) {
        set.delete(sub.id);
        if (set.size === 0) this.byTable.delete(sub.table);
      }
    };
  }

  /** Current subscriber count (metrics/doctor). */
  get size(): number {
    return this.subs.size;
  }

  /** Queued-but-unprocessed CDC events right now. */
  get queueDepth(): number {
    return this.queue.length;
  }

  /**
   * Ingest one CDC event (from the sql-session hook or outbox poller).
   * Overload sheds explicitly — callers see `eventsShed` grow rather than
   * silent latency collapse.
   *
   * @param event - Change payload
   */
  onCdc(event: CdcEventInput): void {
    this.metrics.eventsIn += 1;
    const subs = this.byTable.get(event.tableName);
    if (!subs || subs.size === 0) return;
    if (this.queue.length >= this.maxQueue) {
      this.metrics.eventsShed += 1;
      return;
    }
    const targets: LiveSubscription[] = [];
    for (const id of subs) {
      const sub = this.subs.get(id);
      if (sub) targets.push(sub);
    }
    this.queue.push({ event, subscribers: targets });
    void this.drain();
  }

  /** Worker-pool drain loop. */
  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.queue.length > 0 && this.active < this.concurrency) {
        const item = this.queue.shift();
        if (!item) break;
        this.active += 1;
        void this.classifyBatch(item).finally(() => {
          this.active -= 1;
          if (this.queue.length > 0) void this.drain();
        });
      }
    } finally {
      this.draining = false;
    }
  }

  private async classifyBatch(item: QueueItem): Promise<void> {
    const { event, subscribers } = item;
    await Promise.all(
      subscribers.map(async (sub) => {
        try {
          const event2 = await classifyForSubscriber(this.probes, sub, event);
          if (event2 !== null) {
            const withSeq: LiveQueryEvent =
              event2.kind === "upsert"
                ? {
                    ...event2,
                    ...(event.seq !== undefined ? { seq: event.seq } : {}),
                    ...(event.mutationId ? { mutationId: event.mutationId } : {}),
                  }
                : event2;
            sub.deliver(withSeq);
          }
        } catch {
          this.metrics.checkFailures += 1;
          // Fail loud in metrics, not silently wrong rows: subscriber keeps
          // its stale row until resync — documented v1 trade-off (410/resub).
        }
      }),
    );
  }
}

/**
 * Stateless per-subscriber classification (see module doc for the algorithm).
 *
 * @param probes - Stamped executor factory
 * @param sub - Subscriber under consideration
 * @param event - CDC images
 * @returns Event to deliver, or null to skip
 */
export async function classifyForSubscriber(
  probes: LiveProbeRunner,
  sub: LiveSubscription,
  event: CdcEventInput,
): Promise<LiveQueryEvent | null> {
  // Upserts carry the AFTER image verbatim so subscriber state converges to
  // Postgres's row, not the CDC pipeline's shape (types restored from JSON).
  const after = event.after === null ? null : restoreImage(sub.tableColumns, event.after);
  const afterVisible =
    after !== null &&
    (await probes.runStamped(sub.identity, async (exec) => {
      const { sql, params } = existsProbeSql(sub, after, "SELECT");
      const rows = await exec.query(sql, params);
      return rows.length > 0;
    }));

  if (afterVisible) {
    return { kind: "upsert", row: after };
  }

  // Row gone or invisible now. Decide delete vs revoked vs ignore from the
  // BEFORE image — zero row-set state on the server.
  if (event.before === null) {
    // Insert of an invisible row → not ours to remove.
    return null;
  }

  const beforeWasVisible = await wasBeforeVisible(probes, sub, event);
  if (!beforeWasVisible) return null;

  if (event.op === "delete" || event.after === null) {
    return { kind: "delete", id: String(event.before[sub.pkColumn]) };
  }
  // Row still exists but left our world: RLS denial vs query-window exit.
  const deniedByRls = await rowPassesPolicies(probes, sub, event.after);
  return {
    kind: "revoked",
    id: String(event.before[sub.pkColumn]),
    reason: deniedByRls ? "query" : "rls",
  };
}

/**
 * JSONB round-trips through the outbox turn `number` / `boolean` columns into
 * text (Postgres stores `row_to_json` numerics as numbers, but a `text` PK
 * stays text — only real drift matters). Restore declared column types when
 * the subscription knows its table's column kinds; unknown keys pass through.
 *
 * @param columns - Optional per-column type hints from the subscription
 * @param image - Raw CDC image
 */
function restoreImage(
  columns: Readonly<Record<string, "string" | "number" | "boolean">> | undefined,
  image: Record<string, unknown>,
): Record<string, unknown> {
  if (!columns) return image;
  const out: Record<string, unknown> = { ...image };
  for (const [key, kind] of Object.entries(columns)) {
    const v = out[key];
    if (v === undefined || v === null) continue;
    if (kind === "number" && typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) out[key] = n;
    } else if (kind === "boolean" && typeof v === "string") {
      if (v === "true") out[key] = true;
      else if (v === "false") out[key] = false;
    } else if (kind === "string" && typeof v !== "string") {
      out[key] = String(v);
    }
  }
  return out;
}

/**
 * Before-image visibility: policy replay (`oke.row_passes_policies`) AND,
 * when the runtime knows the query window, the window predicate evaluated
 * client-side over the JSONB image fields present in `before`.
 *
 * The parity gate guarantees replay === native verdict for every shipped
 * policy family — this call must run under the SAME stamp as regular reads.
 */
async function wasBeforeVisible(
  probes: LiveProbeRunner,
  sub: LiveSubscription,
  event: CdcEventInput,
): Promise<boolean> {
  if (event.before === null) return false;
  // Policy layer first — cheap, needed regardless of query window.
  if (!(await rowPassesPolicies(probes, sub, event.before))) return false;
  if (sub.whereSql !== undefined && sub.whereSql !== "") {
    return probes.runStamped(sub.identity, async (exec) => {
      // Project each image field as a real column so compiled list `where`
      // clauses (bare column names) resolve against the JSONB payload.
      const cols = Object.keys(event.before!)
        .map((c) => {
          const ident = /^[A-Za-z_][A-Za-z0-9_]*$/.test(c) ? c : null;
          if (ident === null) return null;
          return `before_row->>'${c.replaceAll("'", "''")}' AS ${JSON.stringify(c).replaceAll('"', '"')}`;
        })
        .filter((v): v is string => v !== null)
        .join(", ");
      const selectList = cols === "" ? "NULL AS ok" : cols;
      const jsonbText = JSON.stringify(event.before!).replace(/'/g, "''");
      const sql =
        `SELECT 1 AS ok FROM (SELECT ${selectList} FROM ` +
        `(SELECT '${jsonbText}'::jsonb AS before_row) _img) bv WHERE ${sub.whereSql}`;
      const rows = await exec.query(sql, [...(sub.whereParams ?? [])]);
      return rows.length > 0;
    });
  }
  return true;
}

/**
 * Replay native policies against a JSONB image under the subscriber's stamp.
 *
 * The row image is inlined as an escaped SQL literal, never bound: Bun.SQL
 * binds JS strings with an unknown type, so `$1::jsonb` casts the wire text
 * into a jsonb *string scalar* (`"\"{…}\""`), whose `->>` lookups return
 * NULL and would silently flip every before-image verdict. Statement-level
 * probes that used literals always passed — this parameter path was the
 * live-PG divergence.
 */
async function rowPassesPolicies(
  probes: LiveProbeRunner,
  sub: LiveSubscription,
  image: Record<string, unknown>,
): Promise<boolean> {
  return probes.runStamped(sub.identity, async (exec) => {
    const inline = JSON.stringify(image).replaceAll("'", "''");
    const rows = await exec.query(
      `SELECT oke.row_passes_policies('${sub.table.replaceAll("'", "''")}', '${inline}'::jsonb, 'SELECT') AS ok`,
      [],
    );
    return rows[0]?.ok === true;
  });
}

/**
 * Build the post-RLS EXISTS probe: PK equality plus the list query window.
 * Query filters decide whether the row belongs to THIS live query
 * ("query exit"), RLS decides visibility — Postgres stays the authority.
 */
function existsProbeSql(
  sub: LiveSubscription,
  _row: Record<string, unknown>,
  _command: "SELECT",
): { sql: string; params: readonly unknown[] } {
  const params: unknown[] = [String(_row[sub.pkColumn] ?? "")];
  let sql = `SELECT 1 AS ok FROM "${sub.table}" WHERE "${sub.pkColumn}" = ?`;
  if (sub.whereSql !== undefined && sub.whereSql !== "") {
    sql += ` AND (${sub.whereSql})`;
    params.push(...(sub.whereParams ?? []));
  }
  sql += " LIMIT 1";
  return { sql, params };
}

/**
 * Identity hash bucket — reserved for the v2 identical-stamp dedupe.
 * Exported so the parity/bench groups can assert grouping behavior.
 */
export function identityBucket(identity: RlsIdentity): string {
  return [
    identity.gate,
    identity.userId,
    rlsScopesJson(identity.scopes),
    identity.tenantId ?? "",
  ].join("|");
}
