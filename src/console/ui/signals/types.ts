/**
 * Signals panel types (console §9.4).
 */

/** Delivery physics — grouping key, not a separate panel. */
export type SignalDelivery = "once" | "broadcast" | "live";

/** Typed failure preserved per attempt. */
export interface SignalFailure {
  readonly code: string;
  readonly message: string;
  readonly at: number;
  readonly attempt: number;
}

/** Dead-letter row with causal link. */
export interface SignalDeadLetter {
  readonly id: string;
  readonly signal: string;
  readonly payload: unknown;
  readonly delivery: SignalDelivery;
  readonly attempts: number;
  readonly failures: readonly SignalFailure[];
  readonly createdAt: number;
  readonly availableAt: number;
  readonly status: "dead";
  readonly causeRunId?: string;
  readonly causeFlow?: string;
}

/** Producer or consumer endpoint. */
export interface SignalEndpoint {
  readonly flowId: string;
  readonly durable: boolean;
  readonly external: boolean;
  readonly peakTier: string;
}

/** One signal in the operator list. */
export interface SignalRecord {
  readonly name: string;
  readonly description?: string;
  readonly delivery: SignalDelivery;
  readonly retries: number;
  readonly deadLetterEnabled: boolean;
  readonly orphaned: boolean;
  readonly pending: number;
  readonly inflight: number;
  readonly dead: number;
  readonly delivered: number;
  readonly outboxLagMs: number | null;
  readonly connections: number;
  readonly throughputPerSec: number;
  readonly schema?: unknown;
  readonly subscribers: ReadonlyArray<{
    readonly id: string;
    readonly lag: number;
    readonly errorCount: number;
  }>;
  readonly recentLive: readonly unknown[];
  readonly deadLetters: readonly SignalDeadLetter[];
  readonly producers: readonly SignalEndpoint[];
  readonly consumers: readonly SignalEndpoint[];
  readonly consumersDurable: boolean | null;
}

/** Grouped list section. */
export interface SignalPhysicsGroup {
  readonly delivery: SignalDelivery;
  readonly label: string;
  readonly signals: readonly SignalRecord[];
}
