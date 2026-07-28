/**
 * Effect-tier presentation for the Flows causality view (console §9.1).
 *
 * Effect tier is the only accent colour. Colour alone is never enough —
 * irreversible effects also carry an outward arrow.
 */

import type { Effects } from "../../../manifest/types.ts";
import {
  reversibilityOf,
  type EffectKind,
  type ReversibilityTier,
} from "../../../kernel/effects.ts";

/** UI column tiers, ranked by reversibility (console §9.1 right column). */
export type UiEffectTier = "reads" | "writes" | "emits" | "external" | "capabilities";

/** One resource/effect row in the right column. */
export interface TieredEffect {
  /** Display tier. */
  readonly tier: UiEffectTier;
  /** Kernel effect kind. */
  readonly kind: EffectKind;
  /** Resource / signal / template / prompt / secret / flow ref. */
  readonly ref: string;
  /** Reversibility taxonomy. */
  readonly reversibility: ReversibilityTier;
  /** How many flows touch this resource (idle inventory). */
  readonly touchCount: number;
  /** Fan-out count for emits (consumers). */
  readonly fanOut?: number;
  /** True when this is a transitive (callee) effect. */
  readonly transitive?: boolean;
}

/** CSS variable used for the irreversible accent — the panel's only accent. */
export const EXTERNAL_ACCENT_VAR = "var(--oke-external)";

/**
 * Map a Manifest {@link Effects} block into ranked tier rows.
 *
 * @param effects - Flow effects (or undefined)
 * @param options - Touch counts and emit fan-out
 */
export function tierEffects(
  effects: Effects | undefined,
  options: {
    readonly touchCounts?: ReadonlyMap<string, number>;
    readonly emitFanOut?: ReadonlyMap<string, number>;
    readonly transitive?: boolean;
  } = {},
): TieredEffect[] {
  if (!effects) return [];
  const touch = options.touchCounts;
  const fan = options.emitFanOut;
  const rows: TieredEffect[] = [];

  const push = (
    tier: UiEffectTier,
    kind: EffectKind,
    refs: readonly string[] | undefined,
  ): void => {
    for (const ref of refs ?? []) {
      rows.push({
        tier,
        kind,
        ref,
        reversibility: reversibilityOf(kind),
        touchCount: touch?.get(ref) ?? 1,
        fanOut: kind === "emit" ? (fan?.get(ref) ?? 0) : undefined,
        transitive: options.transitive,
      });
    }
  };

  push("reads", "read", effects.reads);
  push("writes", "write", effects.writes);
  push("emits", "emit", effects.emits);
  push("external", "send", effects.sends);
  push("external", "ask", effects.asks);
  push("capabilities", "secret", effects.secrets);

  return rows;
}

/**
 * Highest (most severe) effect tier on a flow — drives centre-column flags
 * and invoke confirmation.
 *
 * @param effects - Flow effects
 */
export function peakEffectTier(effects: Effects | undefined): UiEffectTier | "none" {
  if (!effects) return "none";
  if ((effects.sends?.length ?? 0) > 0 || (effects.asks?.length ?? 0) > 0) {
    return "external";
  }
  if ((effects.secrets?.length ?? 0) > 0) return "capabilities";
  if ((effects.emits?.length ?? 0) > 0) return "emits";
  if ((effects.writes?.length ?? 0) > 0) return "writes";
  if ((effects.reads?.length ?? 0) > 0) return "reads";
  return "none";
}

/**
 * Whether a flow has any irreversible (external) effect.
 *
 * @param effects - Flow effects
 */
export function hasExternalEffect(effects: Effects | undefined): boolean {
  return peakEffectTierHasExternal(peakEffectTier(effects));
}

function peakEffectTierHasExternal(tier: UiEffectTier | "none"): boolean {
  return tier === "external";
}

/** Display order for right-column sections. */
export const TIER_ORDER: readonly UiEffectTier[] = [
  "reads",
  "writes",
  "emits",
  "external",
  "capabilities",
] as const;

/** Human labels for tiers. */
export const TIER_LABEL: Readonly<Record<UiEffectTier, string>> = {
  reads: "Reads",
  writes: "Writes",
  emits: "Emits",
  external: "External",
  capabilities: "Capabilities",
};
