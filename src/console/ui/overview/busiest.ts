/**
 * Busiest flow from real Runs volume (console §9.16 day-one invite).
 */

import { groupByDimension } from "../runs/group.ts";
import type { RunRecord } from "../runs/types.ts";
import type { FirstSloInvite } from "./types.ts";

/**
 * Invite to declare a first SLO on the busiest flow by run count.
 *
 * @param runs - Real Runs population
 */
export function firstSloInvite(runs: readonly RunRecord[]): FirstSloInvite | null {
  if (runs.length === 0) return null;
  const groups = groupByDimension(runs, "flow");
  const top = groups[0];
  if (!top || top.key === "(empty)") return null;
  return {
    busiestFlow: top.key,
    runCount: top.count,
    href: `/flows?flow=${encodeURIComponent(top.key)}`,
  };
}
