/**
 * Overdue cron findings for Overview aggregation (console §9.6 · §9.16).
 *
 * Detection is {@link CronHealth.overdue} from ClockRuntime physics —
 * this only lists rows the health check already flagged.
 */

import type { ClockCronRecord } from "./types.ts";

/** One overdue cron finding from the Clock panel. */
export interface OverdueCronFinding {
  readonly name: string;
  readonly driftMs: number | null;
  readonly missedRuns: number;
  readonly nextRunAt?: number;
  readonly flowIds: readonly string[];
}

/**
 * Crons whose health already reports overdue.
 *
 * @param crons - Clock panel cron rows
 */
export function overdueCronFindings(
  crons: readonly ClockCronRecord[],
): readonly OverdueCronFinding[] {
  return crons
    .filter((c) => c.health.overdue)
    .map((c) => ({
      name: c.name,
      driftMs: c.health.driftMs,
      missedRuns: c.health.missedRuns,
      ...(c.nextRunAt !== undefined ? { nextRunAt: c.nextRunAt } : {}),
      flowIds: c.flowIds,
    }))
    .sort(
      (a, b) =>
        b.missedRuns - a.missedRuns || a.name.localeCompare(b.name),
    );
}
