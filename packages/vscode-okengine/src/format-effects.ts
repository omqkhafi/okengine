/**
 * Format Manifest {@link Effects} into the doc-comment CodeLens style:
 * `effects → reads[sql:notes], writes[sql:notes]`
 */

import type { Effects } from "../../../src/manifest/types.ts";

/** Ordered effect keys for stable CodeLens text. */
const EFFECT_KEYS = [
  "reads",
  "writes",
  "emits",
  "sends",
  "asks",
  "secrets",
  "calls",
] as const;

/**
 * Build CodeLens title from extracted effects.
 *
 * @param effects - Manifest effects (may be undefined / empty)
 * @returns Lens text, or `undefined` when there is nothing to show
 */
export function formatEffectsCodeLens(
  effects: Effects | undefined,
): string | undefined {
  if (!effects) return undefined;
  const parts: string[] = [];
  for (const key of EFFECT_KEYS) {
    const refs = effects[key];
    if (!refs || refs.length === 0) continue;
    parts.push(`${key}[${refs.join(", ")}]`);
  }
  if (parts.length === 0) return undefined;
  return `effects → ${parts.join(", ")}`;
}
