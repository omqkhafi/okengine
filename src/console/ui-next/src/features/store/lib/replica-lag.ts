/**
 * Live replica-lag projection from the Console runs buffer.
 */

import type { RunRow } from "@/client.ts";

/**
 * Replica lag of the most recent run that touches any of `effectRefs`.
 * Returns `null` when the buffer has no matching lag — callers fall back
 * to the store-list snapshot.
 *
 * @param runs - Runs buffer (live-merged)
 * @param effectRefs - Store child effect refs (e.g. `sql:bookings`)
 */
export function latestReplicaLagFromRuns(
  runs: readonly RunRow[],
  effectRefs: ReadonlySet<string>,
): number | null {
  let bestStarted = Number.NEGATIVE_INFINITY;
  let lag: number | null = null;
  for (const run of runs) {
    if (run.replicaLagMs == null) continue;
    const touches = run.effects.some((effect) => effectRefs.has(effect.resource));
    if (!touches) continue;
    if (run.startedAt >= bestStarted) {
      bestStarted = run.startedAt;
      lag = run.replicaLagMs;
    }
  }
  return lag;
}
