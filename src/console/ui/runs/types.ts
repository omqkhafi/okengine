/**
 * Runs panel domain types — population view of the wide-event store
 * (console §9.11).
 */

import type { EffectKind, ReversibilityTier } from "../../../kernel/effects.ts";

/** One `fx.log` line on a run (never a separate stream). */
export interface RunLogLine {
  /** Log level. */
  readonly level: "debug" | "info" | "warn" | "error";
  /** Message. */
  readonly message: string;
  /** Optional structured payload. */
  readonly data?: Record<string, unknown>;
  /** Epoch-ms when emitted. */
  readonly at: number;
}

/** One recorded effect on a run. */
export interface RunEffect {
  /** Effect kind. */
  readonly kind: EffectKind;
  /** Resource / signal / template / prompt / secret / flow ref. */
  readonly resource: string;
  /** Epoch-ms when the call started. */
  readonly timestamp: number;
  /** Wall duration in milliseconds. */
  readonly duration: number;
  /** Reversibility tier. */
  readonly reversibility: ReversibilityTier;
}

/**
 * Flat wide-event record for the Runs panel (same store Traces folds).
 */
export interface RunRecord {
  /** Run id (= span id). */
  readonly id: string;
  /** Parent run id when caused by another execution. */
  readonly parentId?: string | null;
  /** Flow name. */
  readonly flow: string;
  /** Optional unit scope. */
  readonly unit?: string | null;
  /** Trigger kind. */
  readonly trigger: string;
  /** Auth plane. */
  readonly plane: string;
  /** Tenant id. */
  readonly tenant?: string | null;
  /** Principal id. */
  readonly principal?: string | null;
  /** Gate names evaluated. */
  readonly gates: readonly string[];
  /** Cache outcome. */
  readonly cache: "hit" | "miss" | "none";
  /** SQL role when observed. */
  readonly replica?: "primary" | "replica" | null;
  /** Replica lag ms when observed. */
  readonly replicaLagMs?: number | null;
  /** AI cost. */
  readonly cost?: number | null;
  /** Prompt version. */
  readonly promptVersion?: number | null;
  /** Build / release version. */
  readonly buildVersion?: string | null;
  /** Epoch-ms start. */
  readonly startedAt: number;
  /** Epoch-ms end. */
  readonly endedAt: number;
  /** Wall duration in milliseconds. */
  readonly durationMs: number;
  /** Typed error code when failed. */
  readonly error?: string | null;
  /** Effect ledger snapshot. */
  readonly effects: readonly RunEffect[];
  /** `fx.log` lines. */
  readonly logs: readonly RunLogLine[];
  /** All queryable dimensions. */
  readonly dimensions: Readonly<
    Record<string, string | number | boolean | null>
  >;
}

/** Comparison operators for dimension clauses. */
export type QueryOp = "=" | "!=" | ">" | "<" | ">=" | "<=";

/** One dimension predicate in a population query. */
export interface QueryClause {
  /** Dimension name (`flow`, `cache`, `duration`, …). */
  readonly dimension: string;
  /** Comparison operator. */
  readonly op: QueryOp;
  /** Compared value (numbers already normalised; duration in ms). */
  readonly value: string | number | boolean;
}

/** Parsed dimension query — AND of clauses (console §9.11). */
export interface DimensionQuery {
  /** Conjuncts. Empty means match all. */
  readonly clauses: readonly QueryClause[];
}

/** Aggregate row for a group-by bucket. */
export interface GroupAggregate {
  /** Group key (dimension value as string, or `(empty)`). */
  readonly key: string;
  /** Run count. */
  readonly count: number;
  /** Mean duration ms. */
  readonly avgDurationMs: number;
  /** p50 duration ms. */
  readonly p50DurationMs: number;
  /** p99 duration ms. */
  readonly p99DurationMs: number;
  /** Sum of cost (0 when absent). */
  readonly sumCost: number;
}

/** One histogram bucket over duration. */
export interface DurationBucket {
  /** Inclusive lower bound (ms). */
  readonly minMs: number;
  /** Exclusive upper bound (ms), except last bucket which is inclusive. */
  readonly maxMs: number;
  /** Runs in this bucket. */
  readonly count: number;
}

/** Selected duration range on the distribution (outlier population). */
export interface DurationRange {
  /** Inclusive lower bound (ms). */
  readonly minMs: number;
  /** Inclusive upper bound (ms). */
  readonly maxMs: number;
}
