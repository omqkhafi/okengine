/**
 * Spam-complaint findings for Overview aggregation (console §9.9 · §9.16).
 *
 * Uses the Channels taxonomy — complaints burn sender reputation.
 */

import { isConsequenceEmphasized } from "./taxonomy.ts";
import type { OutcomeRow } from "./types.ts";

/** One spam-complaint finding from the Channels panel. */
export interface SpamComplaintFinding {
  readonly state: "delivered-then-complained";
  readonly count: number;
  readonly verdict: OutcomeRow["verdict"];
  readonly weight: number;
}

/**
 * Delivered-then-complained rows with consequence emphasis.
 *
 * @param outcomes - Channels seven-state outcome rows
 */
export function spamComplaintFindings(
  outcomes: readonly OutcomeRow[],
): readonly SpamComplaintFinding[] {
  return outcomes
    .filter((r) => r.state === "delivered-then-complained" && isConsequenceEmphasized(r))
    .map((r) => ({
      state: "delivered-then-complained" as const,
      count: r.count,
      verdict: r.verdict,
      weight: r.weight,
    }));
}
