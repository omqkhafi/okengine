/**
 * Pure helpers for Traces row secondary actions (Replay / Copy).
 */

import {
  tracesReplay,
  type ConsoleApiResult,
  type RunRow,
  type TracesReplayInput,
  type TracesReplayResult,
} from "@/client.ts";

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

/**
 * Invoke `POST /console/traces/replay` for a run — shared by the row action
 * and the trace detail Sheet so both hit the same backend path.
 *
 * @param run - Projected run row
 * @param replay - Optional inject (defaults to {@link tracesReplay})
 */
export async function executeTraceReplay(
  run: RunRow,
  replay: typeof tracesReplay = tracesReplay,
): Promise<ConsoleApiResult<TracesReplayResult>> {
  return replay(replayRequestForRun(run));
}

/**
 * Clipboard payload for the Trace row "Copy run ID" action — the real run id.
 *
 * @param run - Projected run row (or any object with `id`)
 */
export function copyRunIdText(run: Pick<RunRow, "id">): string {
  return run.id;
}
