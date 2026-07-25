/**
 * Outlier explanation bridge — calls Prompt 14's {@link explainOutliers}
 * (console §9.11 · §14), never a reimplementation.
 */

import {
  explainOutliers,
  type OutlierFinding,
} from "../../../runs/outlier.ts";
import { runToWideEvent } from "./project.ts";
import type { DurationRange, RunRecord } from "./types.ts";

export type { OutlierFinding };

/**
 * Explain what separates the duration-selected population from the rest.
 *
 * @param runs - Filtered population (current dimension query)
 * @param range - Selected region of the distribution
 */
export function explainDurationOutliers(
  runs: readonly RunRecord[],
  range: DurationRange,
): OutlierFinding[] {
  const events = runs.map(runToWideEvent);
  return explainOutliers(events, {
    select: (e) =>
      e.durationMs >= range.minMs && e.durationMs <= range.maxMs,
    minLift: 0.15,
    ignore: ["duration_ms", "duration", "flow"],
  });
}
