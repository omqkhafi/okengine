/**
 * Seven-state taxonomy of "did not arrive" (console §9.9).
 *
 * Suppression is not failure. Weight follows consequence, not magnitude.
 */

/** Canonical delivery-outcome states for the deliverability console. */
export type DeliveryOutcomeState =
  | "suppressed/opted-out"
  | "suppressed/prior-bounce"
  | "blocked/invalid-address"
  | "soft-bounce"
  | "hard-bounce"
  | "provider-error"
  | "delivered-then-complained";

/** Operator verdict next to each state count. */
export type DeliveryVerdict = "correct" | "retry" | "suppress" | "review";

/** Verdict for each of the seven states. */
export const VERDICT_BY_STATE: Readonly<
  Record<DeliveryOutcomeState, DeliveryVerdict>
> = {
  "suppressed/opted-out": "correct",
  "suppressed/prior-bounce": "correct",
  "blocked/invalid-address": "review",
  "soft-bounce": "retry",
  "hard-bounce": "suppress",
  "provider-error": "retry",
  "delivered-then-complained": "review",
};

/**
 * Consequence weight — higher is worse for sender reputation.
 * Complaints outrank many hard bounces.
 */
export const CONSEQUENCE_WEIGHT: Readonly<
  Record<DeliveryOutcomeState, number>
> = {
  "suppressed/opted-out": 0,
  "suppressed/prior-bounce": 1,
  "blocked/invalid-address": 3,
  "soft-bounce": 4,
  "hard-bounce": 5,
  "provider-error": 4,
  "delivered-then-complained": 10,
};

/** Ordered list of the seven states (stable catalog order). */
export const DELIVERY_OUTCOME_STATES: readonly DeliveryOutcomeState[] = [
  "suppressed/opted-out",
  "suppressed/prior-bounce",
  "blocked/invalid-address",
  "soft-bounce",
  "hard-bounce",
  "provider-error",
  "delivered-then-complained",
];

/** One row in the deliverability taxonomy table. */
export interface OutcomeRow {
  readonly state: DeliveryOutcomeState;
  readonly count: number;
  readonly verdict: DeliveryVerdict;
  readonly weight: number;
}

/**
 * Rank outcome rows by consequence weight (desc), then count (desc).
 *
 * @param rows - Taxonomy rows with counts
 */
export function rankByConsequence(
  rows: readonly OutcomeRow[],
): readonly OutcomeRow[] {
  return [...rows].sort((a, b) => {
    if (b.weight !== a.weight) return b.weight - a.weight;
    return b.count - a.count;
  });
}

/**
 * Build taxonomy rows from state → count, attaching verdict + weight.
 *
 * @param counts - Counts keyed by outcome state
 */
export function buildOutcomeRows(
  counts: Readonly<Partial<Record<DeliveryOutcomeState, number>>>,
): readonly OutcomeRow[] {
  const rows: OutcomeRow[] = DELIVERY_OUTCOME_STATES.map((state) => ({
    state,
    count: counts[state] ?? 0,
    verdict: VERDICT_BY_STATE[state],
    weight: CONSEQUENCE_WEIGHT[state],
  }));
  return rankByConsequence(rows);
}

/**
 * Whether a receipt status is one of the seven "did not arrive" states.
 *
 * @param status - Receipt status
 */
export function isDeliveryOutcomeState(
  status: string,
): status is DeliveryOutcomeState {
  return (DELIVERY_OUTCOME_STATES as readonly string[]).includes(status);
}

/**
 * Format a fallback attempt chain as human-readable prose.
 *
 * @param attempts - Ordered send attempts
 * @returns e.g. `"whatsapp failed → sms succeeded"`
 */
export function formatAttemptChain(
  attempts: readonly {
    readonly driverId: string;
    readonly ok: boolean;
  }[],
): string {
  if (attempts.length === 0) return "";
  return attempts
    .map((a) => `${a.driverId} ${a.ok ? "succeeded" : "failed"}`)
    .join(" → ");
}
