/**
 * Pure helpers for Traces row secondary actions (Replay / Copy).
 */

import type { RunRow, TracesReplayInput } from "@/client.ts";

/**
 * True when replaying this run should default to dry-run (send/ask / irreversible).
 *
 * @param run - Projected run row
 */
export function runNeedsDryRun(run: RunRow): boolean {
  return run.effects.some(
    (e) => e.kind === "send" || e.kind === "ask" || e.reversibility === "irreversible",
  );
}

/**
 * Build the POST body for `console.traces.replay` from a list row.
 *
 * @param run - Projected run row
 */
export function replayRequestForRun(run: RunRow): TracesReplayInput {
  return {
    rootId: run.id,
    dryRun: runNeedsDryRun(run),
  };
}
