/**
 * Signal driver contracts — protocol-named (`memory` · `postgres` · `redis` · `nats`).
 */

import type { SignalDelivery } from "../manifest/types.ts";
import type { SignalDecl } from "../elements/signal/declare.ts";
import { OkeError, OKE_ERRORS } from "../kernel/errors.ts";
import {
  isStandardSchema,
  normalizeIssuePath,
  type SchemaInput,
} from "../validation/standard-schema.ts";

/** Protocol ids for signal drivers. */
export type SignalDriverId = "memory" | "postgres" | "redis" | "nats";

/**
 * Typed failure reason preserved on every delivery attempt.
 *
 * Survives into the DLQ so operators can see the full attempt history.
 */
export interface SignalFailureReason {
  /** Machine-readable failure code. */
  readonly code: string;
  /** Human-readable detail. */
  readonly message: string;
  /** Epoch-ms when the attempt failed. */
  readonly at: number;
  /** 1-based attempt number that failed. */
  readonly attempt: number;
}

/** Options for {@link SignalBus.emit} / {@link SignalTransaction.emit}. */
export interface SignalEmitOptions {
  /**
   * Per-key serialization for `once` delivery.
   *
   * When set, no two messages sharing the same `(signal, key)` are claimed
   * concurrently — the in-flight message's visibility lease is the lock.
   * Omit for pure competing-consumer behavior (no ordering guarantee).
   */
  readonly key?: string;
}

/** A durable signal message. */
export interface SignalMessage {
  readonly id: string;
  readonly signal: string;
  readonly payload: unknown;
  /** Optional ordering key from {@link SignalEmitOptions.key}. */
  readonly key?: string;
  readonly delivery: SignalDelivery;
  readonly attempts: number;
  readonly failures: readonly SignalFailureReason[];
  readonly createdAt: number;
  /** Available for claim (once); null while locked / delivered. */
  readonly availableAt: number;
  readonly status: "pending" | "inflight" | "delivered" | "dead";
}

/** Dead-letter entry with full attempt history. */
export interface DeadLetter extends SignalMessage {
  readonly status: "dead";
}

/** Per-subscriber lag / errors (broadcast physics). */
export interface SignalSubscriberStats {
  /** Stable subscriber id. */
  readonly id: string;
  /** Undelivered message count for this subscriber. */
  readonly lag: number;
  /** Handler failures attributed to this subscriber. */
  readonly errorCount: number;
}

/**
 * Operator-plane snapshot of one signal's live queue state.
 *
 * Reads the real bus — the Console must not reimplement delivery physics.
 */
export interface SignalStats {
  /** Signal name. */
  readonly signal: string;
  /** Delivery physics. */
  readonly delivery: SignalDelivery;
  /** Competing / fan-out pending count. */
  readonly pending: number;
  /** Claimed but not yet acked (`once`). */
  readonly inflight: number;
  /** Dead-letter count. */
  readonly dead: number;
  /** Successfully delivered count. */
  readonly delivered: number;
  /** Declared retry budget. */
  readonly retries: number;
  /** Whether exhausted messages enter the DLQ. */
  readonly deadLetterEnabled: boolean;
  /**
   * Age (ms) of the oldest committed-but-not-yet-relayed/consumed message.
   * Surfaces transactional outbox lag (postgres-default case).
   */
  readonly outboxLagMs: number | null;
  /** Broadcast subscriber rows. */
  readonly subscribers: readonly SignalSubscriberStats[];
  /** Live connection count (`delivery: "live"`). */
  readonly connections: number;
  /** Deliveries completed in the last trailing second. */
  readonly throughputPerSec: number;
  /** Declared payload schema when present. */
  readonly schema: unknown;
  /** Recent live payloads (newest last) for the payload monitor. */
  readonly recentLive: readonly unknown[];
  /** Dead-letter entries with typed per-attempt failures. */
  readonly deadLetters: readonly DeadLetter[];
}

/** Options for {@link SignalBus.replay}. */
export interface SignalReplayOptions {
  /** Signal name. */
  readonly signal: string;
  /** Dead-letter message ids to replay (empty = all dead for the signal). */
  readonly messageIds?: readonly string[];
  /** Broadcast: target a single subscriber. */
  readonly subscriberId?: string;
  /** Max replays per second — never an unthrottled flood. */
  readonly ratePerSec: number;
  /** When true, invoke handlers but leave DLQ rows untouched. */
  readonly dryRun: boolean;
  /** Optional payload overrides keyed by message id (schema form edits). */
  readonly payloads?: Readonly<Record<string, unknown>>;
}

/** Per-message result from a replay / dry-run pass. */
export interface SignalReplayMessageResult {
  readonly id: string;
  readonly ok: boolean;
  readonly error?: { readonly code: string; readonly message: string };
}

/** Irreversible effect intercepted during a dry-run replay. */
export interface SignalDryRunStub {
  readonly kind: "send" | "ask";
  readonly resource: string;
  readonly messageId?: string;
}

/** Aggregate result of {@link SignalBus.replay}. */
export interface SignalReplayResult {
  readonly attempted: number;
  readonly succeeded: number;
  readonly failed: number;
  readonly dryRun: boolean;
  readonly results: readonly SignalReplayMessageResult[];
  /**
   * Irreversible effects recorded as "would have fired" during dry-run.
   * Empty for live replay.
   */
  readonly wouldHaveFired: readonly SignalDryRunStub[];
  /**
   * When set, dry-run was refused because a safe stubbed run is impossible
   * for this consumer shape (same refusal spirit as Traces).
   */
  readonly refused?: {
    readonly code: "dry_run_unsafe";
    readonly reason: string;
  };
}

/** Options for {@link SignalBus.discard}. */
export interface SignalDiscardOptions {
  readonly signal: string;
  readonly messageIds: readonly string[];
}

/** Unsubscribe handle. */
export type SignalUnsubscribe = () => void | Promise<void>;

/** Consumer handler for once / broadcast. */
export type SignalHandler = (message: SignalMessage) => void | Promise<void>;

/** Live client handler (payload only). */
export type LiveHandler = (payload: unknown) => void | Promise<void>;

/**
 * Transaction that enrols store writes and signal emits atomically.
 *
 * Postgres: emit inserts into the outbox on the caller's connection.
 * Redis / NATS: emit still writes the outbox first; relay runs after commit.
 */
export interface SignalTransaction {
  /**
   * Stage a durable paired write (dual-write proof / chaos tests).
   *
   * @param key - Logical key
   * @param value - Value
   */
  write(key: string, value: unknown): Promise<void>;
  /**
   * Stage an emit into the same transaction.
   *
   * @param signal - Signal name
   * @param payload - Payload
   * @param options - Optional emit options (`key` for per-key once ordering)
   */
  emit(signal: string, payload?: unknown, options?: SignalEmitOptions): Promise<void>;
  /** Commit writes + emits together. */
  commit(): Promise<void>;
  /** Discard the transaction — nothing is visible. */
  rollback(): Promise<void>;
}

/** Default visibility lease for `once` claims (ms). */
export const SIGNAL_DEFAULT_LEASE_MS = 30_000;

/** Options when opening a signal bus. */
export interface SignalOpenOptions {
  /** Registered signal declarations (name → decl). */
  readonly signals: ReadonlyMap<string, SignalDecl>;
  /** Clock. */
  readonly now?: () => number;
  /**
   * Visibility lease for `once` claims (ms).
   * Expired `inflight` rows are reclaimed lazily at the next claim.
   * Defaults to {@link SIGNAL_DEFAULT_LEASE_MS}.
   */
  readonly leaseMs?: number;
  /**
   * Durable path for chaos / crash recovery tests.
   * When set, committed state survives process death.
   */
  readonly durablePath?: string;
  /** Injected SQL client / connection for postgres outbox. */
  readonly sql?: unknown;
  /** Injected redis-protocol client (streams + pub/sub). */
  readonly redis?: SignalRedisClientLike;
  /** Injected NATS / JetStream-like client. */
  readonly nats?: SignalNatsClientLike;
  /** Outbox SQL for redis/nats relay (defaults to in-process). */
  readonly outboxSql?: unknown;
}

/**
 * Minimal Redis surface used by the signal redis driver.
 * Streams for `once`, pub/sub for `broadcast` / `live`.
 */
export interface SignalRedisClientLike {
  xadd(key: string, id: string, fields: Record<string, string>): Promise<string>;
  xgroupCreate(
    key: string,
    group: string,
    id: string,
    opts?: { mkstream?: boolean },
  ): Promise<void>;
  xreadgroup(
    group: string,
    consumer: string,
    key: string,
    count: number,
  ): Promise<Array<{ id: string; fields: Record<string, string> }>>;
  xack(key: string, group: string, id: string): Promise<number>;
  publish(channel: string, message: string): Promise<number>;
  subscribe(channel: string, listener: (message: string) => void): Promise<() => void>;
}

/** Minimal NATS / JetStream surface. */
export interface SignalNatsClientLike {
  publish(subject: string, data: Uint8Array | string): Promise<void>;
  subscribe(
    subject: string,
    opts: {
      queue?: string;
      callback: (data: Uint8Array) => void | Promise<void>;
    },
  ): Promise<() => void>;
}

/** Open signal bus from a driver. */
export interface SignalBus {
  readonly driverId: SignalDriverId;
  /**
   * Emit outside a transaction (auto-commits a one-shot txn).
   *
   * @param signal - Signal name
   * @param payload - Payload
   * @param options - Optional emit options (`key` for per-key once ordering)
   */
  emit(signal: string, payload?: unknown, options?: SignalEmitOptions): Promise<void>;
  /** Begin a transaction that enrols writes + emits. */
  begin(): Promise<SignalTransaction>;
  /**
   * Subscribe a competing / fan-out consumer.
   *
   * @param signal - Signal name
   * @param subscriberId - Stable subscriber id (exactly-once per id for once)
   * @param handler - Message handler
   */
  subscribe(
    signal: string,
    subscriberId: string,
    handler: SignalHandler,
  ): Promise<SignalUnsubscribe>;
  /**
   * Client-subscribable live feed.
   *
   * @param signal - Signal name (`delivery: "live"`)
   * @param handler - Payload handler
   */
  live(signal: string, handler: LiveHandler): Promise<SignalUnsubscribe>;
  /**
   * Process pending work until idle (deterministic tests).
   */
  drain(): Promise<void>;
  /**
   * Inspect dead-letter queue for a signal.
   *
   * @param signal - Signal name
   */
  deadLetters(signal: string): Promise<readonly DeadLetter[]>;
  /**
   * Operator inspect — queue depths, subscribers, outbox lag, DLQ.
   *
   * @param signal - Optional name; omit for every registered signal
   */
  inspect(signal?: string): Promise<readonly SignalStats[]>;
  /**
   * Replay dead letters at a controlled rate (or dry-run without mutating).
   *
   * @param options - Target messages, rate, dry-run, payload overrides
   */
  replay(options: SignalReplayOptions): Promise<SignalReplayResult>;
  /**
   * Permanently discard dead-letter messages.
   *
   * @param options - Signal + message ids
   */
  discard(options: SignalDiscardOptions): Promise<{ readonly discarded: number }>;
  /**
   * Read a durable paired write (post-commit / post-recovery).
   *
   * @param key - Key written via {@link SignalTransaction.write}
   */
  getWrite(key: string): Promise<unknown>;
  /** Close the bus. */
  close(): Promise<void>;
}

/** Signal driver factory. */
export interface SignalDriver {
  readonly id: SignalDriverId;
  /**
   * Open a bus.
   *
   * @param options - Declarations and injected clients
   */
  open(options: SignalOpenOptions): Promise<SignalBus>;
}

/**
 * Validate an emit payload against the signal declaration's Standard Schema.
 *
 * @param name - Signal name (for OKE1043)
 * @param decl - Declared signal
 * @param payload - Raw emit payload
 */
export async function validateSignalEmitPayload(
  name: string,
  decl: SignalDecl,
  payload: unknown,
): Promise<unknown> {
  const schema = decl.schema as SchemaInput | undefined;
  if (schema === undefined || schema === null || !isStandardSchema(schema)) {
    return payload ?? null;
  }
  const result = await schema["~standard"].validate(payload ?? null);
  if (!result.issues) return result.value;
  const detail =
    result.issues
      .map((i) => {
        const path = normalizeIssuePath(i.path);
        return path.length > 0 ? `${path.join(".")}: ${i.message}` : i.message;
      })
      .join("; ") || "invalid payload";
  throw new OkeError(OKE_ERRORS.SIGNAL_SCHEMA, { resource: name, detail });
}
