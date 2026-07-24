/**
 * Signal driver contracts — protocol-named (`memory` · `postgres` · `redis` · `nats`).
 */

import type { SignalDelivery } from "../manifest/types.ts";
import type { SignalDecl } from "../elements/signal/declare.ts";

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

/** A durable signal message. */
export interface SignalMessage {
  readonly id: string;
  readonly signal: string;
  readonly payload: unknown;
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
   */
  emit(signal: string, payload?: unknown): Promise<void>;
  /** Commit writes + emits together. */
  commit(): Promise<void>;
  /** Discard the transaction — nothing is visible. */
  rollback(): Promise<void>;
}

/** Options when opening a signal bus. */
export interface SignalOpenOptions {
  /** Registered signal declarations (name → decl). */
  readonly signals: ReadonlyMap<string, SignalDecl>;
  /** Clock. */
  readonly now?: () => number;
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
  subscribe(
    channel: string,
    listener: (message: string) => void,
  ): Promise<() => void>;
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
   */
  emit(signal: string, payload?: unknown): Promise<void>;
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
