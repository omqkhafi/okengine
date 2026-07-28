/**
 * Map span effects onto the Flows effect-tier vocabulary (console §9.3).
 */

import type { EffectKind } from "../../../kernel/effects.ts";
import type { UiEffectTier } from "../flows/tiers.ts";
import type { SpanTier, TraceEffect, TraceSpan } from "./types.ts";

/**
 * UI tier for a single effect kind.
 *
 * @param kind - Kernel effect kind
 */
export function tierOfKind(kind: EffectKind): UiEffectTier {
  switch (kind) {
    case "read":
      return "reads";
    case "write":
      return "writes";
    case "emit":
      return "emits";
    case "send":
    case "ask":
      return "external";
    case "secret":
      return "capabilities";
    case "call":
      return "reads";
  }
}

/**
 * Highest (most severe) effect tier on a span.
 *
 * @param effects - Span effects
 */
export function peakSpanTier(effects: readonly TraceEffect[]): SpanTier {
  let peak: SpanTier = "none";
  for (const e of effects) {
    const t = tierOfKind(e.kind);
    if (rank(t) > rank(peak)) peak = t;
  }
  return peak;
}

/**
 * Whether any span in the set has an irreversible (external) effect.
 *
 * @param spans - Spans in the trace
 */
export function traceHasExternal(spans: readonly TraceSpan[]): boolean {
  return spans.some((s) => peakSpanTier(s.effects) === "external");
}

function rank(tier: SpanTier): number {
  switch (tier) {
    case "external":
      return 5;
    case "capabilities":
      return 4;
    case "emits":
      return 3;
    case "writes":
      return 2;
    case "reads":
      return 1;
    case "none":
      return 0;
  }
}
