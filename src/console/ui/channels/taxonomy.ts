/**
 * Seven-state taxonomy presentation (console §9.9).
 *
 * Weight follows consequence, not magnitude.
 */

import type { DeliveryOutcomeState, DeliveryVerdict, OutcomeRow } from "./types.ts";

/** Human labels for states. */
export const STATE_LABEL: Readonly<Record<DeliveryOutcomeState, string>> = {
  "suppressed/opted-out": "Suppressed · opted out",
  "suppressed/prior-bounce": "Suppressed · prior hard bounce",
  "blocked/invalid-address": "Blocked · invalid address",
  "soft-bounce": "Soft bounce",
  "hard-bounce": "Hard bounce",
  "provider-error": "Provider error",
  "delivered-then-complained": "Delivered then complained",
};

/** Human labels for verdicts. */
export const VERDICT_LABEL: Readonly<Record<DeliveryVerdict, string>> = {
  correct: "correct",
  retry: "retry",
  suppress: "suppress",
  review: "review",
};

/**
 * Sort rows by consequence weight (already ranked server-side; re-sort locally).
 *
 * @param rows - Outcome rows
 */
export function sortByConsequence(rows: readonly OutcomeRow[]): readonly OutcomeRow[] {
  return [...rows].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.count - a.count;
  });
}

/**
 * Whether a row should be visually emphasized (high consequence with count).
 *
 * @param row - Outcome row
 */
export function isConsequenceEmphasized(row: OutcomeRow): boolean {
  return row.weight >= 10 && row.count > 0;
}
