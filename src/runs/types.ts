/**
 * Wide-event types for the runs store.
 *
 * One flow execution = one wide event = one span. Traces, Overview and Runs
 * are three views of this single store (console §9.11).
 */

import type { EffectEntry } from "../kernel/effects.ts";
import type { RunLogLine } from "../kernel/run-telemetry.ts";
import type { FlowPlane } from "../manifest/types.ts";

export type { RunLogLine };

/** Protocol ids for runs store drivers. */
export type RunsDriverId = "files" | "memory" | "postgres" | "clickhouse";

/** Typed error carried on a failed run. */
export interface RunError {
  /** Declared or framework error code. */
  readonly code: string;
  /** Human-readable message when present. */
  readonly message?: string;
}

/**
 * Declared / observed dimensions available without manual instrumentation.
 * Extra keys are allowed for outlier analysis.
 */
export type RunDimensions = Record<
  string,
  string | number | boolean | null | undefined
>;

/**
 * One wide event — the atomic observability record.
 *
 * Personal fields that must survive erasure go in {@link archived}
 * (ciphertext under a per-subject Vault key).
 */
export interface WideEvent {
  /** Run id (= span id). */
  readonly id: string;
  /** Parent run id when this execution was caused by another (trace chain). */
  readonly parentId?: string;
  /** Flow name. */
  readonly flow: string;
  /** Optional unit scope. */
  readonly unit?: string;
  /** Trigger kind (`http` · `every` · `signal` · `cdc` · `internal`). */
  readonly trigger: string;
  /** Auth plane. */
  readonly plane: FlowPlane;
  /** Tenant id when multi-tenancy is active. */
  readonly tenant?: string | null;
  /** Principal — user id or operator id. */
  readonly principal?: string | null;
  /** Subject id for crypto-shredding (defaults to principal / tenant). */
  readonly subjectId?: string | null;
  /** Gate names evaluated for this invocation. */
  readonly gates: readonly string[];
  /** Cache outcome observed through `fx.cache`. */
  readonly cache: "hit" | "miss" | "none";
  /** SQL role when a store runtime routed the flow. */
  readonly replica?: "primary" | "replica";
  /** Replica lag in milliseconds when observed. */
  readonly replicaLagMs?: number;
  /** AI cost accrued during the run. */
  readonly cost?: number;
  /** Prompt version when `fx.ask` was used. */
  readonly promptVersion?: number;
  /** Build / release version when known. */
  readonly buildVersion?: string;
  /** Typed error when the flow failed. */
  readonly error?: RunError | null;
  /** Effect ledger snapshot. */
  readonly effects: readonly EffectEntry[];
  /**
   * `fx.log` lines — a field on the run, not a parallel stream.
   */
  readonly logs: readonly RunLogLine[];
  /** Wall duration in milliseconds. */
  readonly durationMs: number;
  /** Epoch-ms start. */
  readonly startedAt: number;
  /** Epoch-ms end. */
  readonly endedAt: number;
  /**
   * Crypto-shredded personal fields: field name → ciphertext.
   * Readable only while the per-subject Vault key exists.
   */
  readonly archived?: Readonly<Record<string, string>>;
  /**
   * All queryable dimensions (declared + observed).
   * Outlier explanation compares these across populations.
   */
  readonly dimensions: RunDimensions;
}

/** Retention / redaction policy (lifecycle — not locality). */
export interface RunsRetention {
  /**
   * Keep operational runs for this duration, or `"forever"` (default).
   * Deletion is a compliance action, not a cleanup job.
   */
  readonly keep?: string | "forever";
  /** Redact personal fields older than these durations. */
  readonly redact?: Readonly<Record<string, string>>;
}

/** One SQL result row. */
export type RunsRow = Record<string, unknown>;

/** Runs store handle — append wide events and query them. */
export interface RunsStore {
  /** Protocol driver id. */
  readonly driverId: RunsDriverId;
  /**
   * Append one wide event (buffered; may flush to a partition).
   *
   * @param event - Wide event to store
   */
  append(event: WideEvent): Promise<void>;
  /**
   * Flush buffered events to durable partitions.
   */
  flush(): Promise<void>;
  /**
   * Run SQL against all visible partitions (local + object storage).
   *
   * @param sql - DuckDB / driver SQL
   */
  query(sql: string): Promise<RunsRow[]>;
  /**
   * Materialise all events (test helper / small stores).
   */
  all(): Promise<WideEvent[]>;
  /** Close underlying resources. */
  close(): Promise<void>;
}

/** Driver factory for the runs store. */
export interface RunsDriver {
  /** Protocol id. */
  readonly id: RunsDriverId;
  /**
   * Open a store.
   *
   * @param options - Driver-specific options
   */
  open(options?: RunsOpenOptions): Promise<RunsStore>;
}

/** Options when opening a runs store. */
export interface RunsOpenOptions {
  /** Local root for recent Parquet partitions (`files`). */
  readonly localRoot?: string;
  /** Optional object-storage bucket for older partitions (`files`). */
  readonly remote?: {
    readonly bucket: import("../drivers/types.ts").FilesBucket;
    readonly prefix?: string;
  };
  /** Injected local files bucket (tests). */
  readonly localBucket?: import("../drivers/types.ts").FilesBucket;
  /**
   * Age after which new writes go to object storage (engine locality detail).
   * Default: 7 days. User never declares archive tiers.
   */
  readonly hotWindowMs?: number;
  /** Retention policy (compliance). */
  readonly retention?: RunsRetention;
  /** Postgres connection URL or injected client. */
  readonly url?: string;
  /** Injected client for postgres / clickhouse fakes. */
  readonly client?: unknown;
  /** Table / dataset name. */
  readonly name?: string;
  /** Build version stamped on every event when not set on the event. */
  readonly buildVersion?: string;
}
