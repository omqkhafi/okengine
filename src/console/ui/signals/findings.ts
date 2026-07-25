/**
 * Dead-letter findings for Overview aggregation (console §9.4 · §9.16).
 *
 * Detection is the panel's `dead` / `deadLetters` projection — this only
 * surfaces rows that already failed into the DLQ.
 */

import type { SignalRecord } from "./types.ts";

/** One dead-letter finding from the Signals panel. */
export interface DeadLetterFinding {
  readonly signal: string;
  readonly dead: number;
  readonly delivery: SignalRecord["delivery"];
}

/**
 * Signals with dead letters waiting in the DLQ.
 *
 * @param signals - Signals panel rows
 */
export function deadLetterFindings(
  signals: readonly SignalRecord[],
): readonly DeadLetterFinding[] {
  return signals
    .filter((s) => s.dead > 0)
    .map((s) => ({
      signal: s.name,
      dead: s.dead,
      delivery: s.delivery,
    }))
    .sort((a, b) => b.dead - a.dead || a.signal.localeCompare(b.signal));
}
