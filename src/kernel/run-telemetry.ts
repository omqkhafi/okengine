/**
 * Per-invocation telemetry collected through `fx` without flow instrumentation.
 * Consumed by the runs store when building wide events.
 */

/** One structured log line captured from `fx.log` during a run. */
export interface RunLogLine {
  /** Log level. */
  readonly level: "debug" | "info" | "warn" | "error";
  /** Message (secrets already redacted when a vault is wired). */
  readonly message: string;
  /** Optional structured payload. */
  readonly data?: Record<string, unknown>;
  /** Epoch-ms when the line was emitted. */
  readonly at: number;
}

/**
 * Mutable collector attached to one `createFx` invocation.
 * Cache hits/misses, gates, cost, and logs accumulate here automatically.
 */
export interface RunTelemetry {
  /** Cache hit count via `fx.cache`. */
  cacheHits: number;
  /** Cache miss count via `fx.cache`. */
  cacheMisses: number;
  /** Gate names evaluated (when a gate runtime records them). */
  gates: string[];
  /** SQL role when observed. */
  replica?: "primary" | "replica";
  /** Replica lag ms when observed. */
  replicaLagMs?: number;
  /** Accumulated AI cost. */
  cost: number;
  /** Last prompt version seen. */
  promptVersion?: number;
  /** Subject for crypto-shredding when known. */
  subjectId?: string;
  /** Extra dimensions contributed by the engine (not by the flow body). */
  dimensions: Record<string, string | number | boolean | null>;
  /** Captured `fx.log` lines. */
  logs: RunLogLine[];
}

/**
 * Create an empty telemetry collector.
 */
export function createRunTelemetry(): RunTelemetry {
  return {
    cacheHits: 0,
    cacheMisses: 0,
    gates: [],
    cost: 0,
    dimensions: {},
    logs: [],
  };
}

/**
 * Derive cache dimension from hit/miss counters.
 *
 * @param t - Telemetry
 */
export function cacheDimensionOf(
  t: RunTelemetry,
): "hit" | "miss" | "none" {
  if (t.cacheHits > 0 && t.cacheMisses === 0) return "hit";
  if (t.cacheMisses > 0) return "miss";
  return "none";
}
