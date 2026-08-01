/**
 * AI rate-limit presets — reuse {@link gate.rate}, no parallel budgeting.
 *
 * Cost caps stay on prompt/agent `budget` decls. These presets throttle
 * request volume on HTTP triggers that wrap `fx.ask` / agents / embeds.
 */

import { gate, type RateGateDecl } from "../gate/declare.ts";

/** Preset keys for AI-facing HTTP edges. */
export type AiRatePreset = "ask" | "agent" | "embed";

/** One AI rate preset row. */
export type AiRatePresetSpec = {
  readonly max: number;
  readonly per: string;
  readonly keyBy: string;
};

/**
 * Sensible defaults: AI calls are far more expensive per request than
 * ordinary HTTP, so limits are tighter than typical API rate limits.
 * Prefer `keyBy: "user"` when the edge is authenticated; use `ip` on
 * public unauthenticated AI surfaces.
 */
export const AI_RATE_PRESETS: Readonly<Record<AiRatePreset, AiRatePresetSpec>> = {
  ask: { max: 20, per: "1m", keyBy: "user" },
  agent: { max: 10, per: "1m", keyBy: "user" },
  embed: { max: 60, per: "1m", keyBy: "user" },
};

/**
 * Build a `gate.rate` declaration from an AI preset.
 *
 * @param kind - ask · agent · embed
 * @param overrides - Optional max / per / keyBy overrides
 */
export function aiRateGate(
  kind: AiRatePreset,
  overrides?: {
    readonly max?: number;
    readonly per?: string;
    readonly keyBy?: string;
    readonly description?: string;
  },
): RateGateDecl {
  const preset = AI_RATE_PRESETS[kind];
  return gate.rate({
    max: overrides?.max ?? preset.max,
    per: overrides?.per ?? preset.per,
    keyBy: overrides?.keyBy ?? preset.keyBy,
    description:
      overrides?.description ??
      `AI ${kind} rate limit (${overrides?.max ?? preset.max}/${overrides?.per ?? preset.per})`,
  });
}

/**
 * Materialize all AI rate gate decls (ask + agent + embed).
 *
 * @param enabled - When false, returns []
 */
export function createAiRateGates(enabled = true): readonly RateGateDecl[] {
  if (!enabled) return [];
  return [aiRateGate("ask"), aiRateGate("agent"), aiRateGate("embed")];
}
