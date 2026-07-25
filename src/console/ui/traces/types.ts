/**
 * Trace panel domain types (console §9.3 · §9.11).
 *
 * One flow execution = one wide event = one span. A trace is a causal chain
 * of runs joined across async boundaries via {@link TraceSpan.parentId}.
 */

import type { EffectKind, ReversibilityTier } from "../../../kernel/effects.ts";
import type { UiEffectTier } from "../flows/tiers.ts";

/** One recorded effect on a span (subset of the ledger entry). */
export interface TraceEffect {
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

/** Why a run appears in the sampled list (console §9.3). */
export type SampleReason = "full" | "error" | "sample" | "boost";

/**
 * One span in a trace — the UI projection of a wide event.
 */
export interface TraceSpan {
  /** Run id (= span id). */
  readonly id: string;
  /** Parent run id when caused by another execution. */
  readonly parentId?: string;
  /** Flow name. */
  readonly flow: string;
  /** Optional unit scope. */
  readonly unit?: string;
  /** Trigger kind. */
  readonly trigger: string;
  /** Epoch-ms start. */
  readonly startedAt: number;
  /** Epoch-ms end. */
  readonly endedAt: number;
  /** Wall duration in milliseconds. */
  readonly durationMs: number;
  /** Typed error code when the flow failed. */
  readonly errorCode?: string | null;
  /** Effect ledger snapshot. */
  readonly effects: readonly TraceEffect[];
  /** AI cost accrued during the run. */
  readonly cost?: number;
  /** Sampling classification for honest list labelling. */
  readonly sampled: SampleReason;
}

/** Peak UI effect tier for a span (drives waterfall colour). */
export type SpanTier = UiEffectTier | "none";

/** One bar in a list-row mini-waterfall. */
export interface MiniBar {
  /** Relative start 0..1. */
  readonly start: number;
  /** Relative width 0..1. */
  readonly width: number;
  /** Effect tier colour key. */
  readonly tier: SpanTier;
  /** True when this bar is the failing effect. */
  readonly failed?: boolean;
}

/** Filter by declared effect (console §9.3 — the filter no one else can offer). */
export type EffectFilter =
  | { readonly kind: "wrote"; readonly resource: string }
  | { readonly kind: "asked" }
  | { readonly kind: "sent"; readonly resource?: string }
  | { readonly kind: "secret"; readonly resource?: string }
  | { readonly kind: "cost"; readonly min: number };

/** Work interval on a absolute timeline (before folding). */
export interface WorkInterval {
  /** Stable id for the segment. */
  readonly id: string;
  /** Display label. */
  readonly label: string;
  /** Absolute start (ms, same epoch as spans). */
  readonly startMs: number;
  /** Absolute end. */
  readonly endMs: number;
  /** Peak effect tier. */
  readonly tier: SpanTier;
  /** Span this interval belongs to. */
  readonly spanId: string;
  /** True when this interval carries the typed failure. */
  readonly failed?: boolean;
}

/** Folded-time timeline segment after collapse. */
export type TimelineSegment =
  | {
      readonly kind: "work";
      readonly id: string;
      readonly label: string;
      readonly startMs: number;
      readonly endMs: number;
      readonly durationMs: number;
      readonly tier: SpanTier;
      readonly spanId: string;
      readonly critical: boolean;
      readonly failed: boolean;
      /** Display width weight (proportional to real work). */
      readonly displayMs: number;
    }
  | {
      readonly kind: "fold";
      readonly id: string;
      readonly startMs: number;
      readonly endMs: number;
      readonly durationMs: number;
      readonly label: string;
      readonly expanded: boolean;
      /** Collapsed folds use a fixed weight; expanded use full duration. */
      readonly displayMs: number;
    };
