/**
 * Traces panel — folded-time causal chain (console §9.3).
 *
 * Pure modules live here so `bun test src/console/ui/traces` gates behaviour
 * without mounting the full SPA.
 */

export {
  buildCausalChain,
  groupTraceRoots,
  indexSpans,
  initialFocusSpanId,
  type CausalChain,
  type TraceRoot,
} from "./chain.ts";
export { criticalPathSpanIds, workMs } from "./critical-path.ts";
export {
  matchesEffectFilter,
  parseEffectFilter,
  serializeEffectFilter,
  traceMatchesEffectFilter,
} from "./filter.ts";
export {
  COLLAPSED_FOLD_DISPLAY_MS,
  DEFAULT_FOLD_THRESHOLD_MS,
  foldTimeline,
  formatFoldLabel,
  intervalsFromSpans,
  type FoldedTimeline,
  type FoldOptions,
} from "./fold.ts";
export { miniWaterfall, rootErrorCode } from "./mini.ts";
export { replayDecision, type ReplayDecision } from "./replay.ts";
export {
  boostFlowFully,
  DEFAULT_SAMPLING_LABEL,
  FULL_TRACE_BOOST_MS,
  pruneBoosts,
  samplingLabel,
  type FullTraceBoost,
} from "./sampling.ts";
export {
  closeTrace,
  effectFilterOf,
  expandedFoldsOf,
  openTrace,
  parseTracesSearch,
  serializeTracesSearch,
  setEffectFilter,
  toggleFold,
  TracesSearchSchema,
  type TracesSearch,
} from "./search.ts";
export { peakSpanTier, tierOfKind, traceHasExternal } from "./tier.ts";
export type {
  EffectFilter,
  MiniBar,
  SampleReason,
  SpanTier,
  TimelineSegment,
  TraceEffect,
  TraceSpan,
  WorkInterval,
} from "./types.ts";
