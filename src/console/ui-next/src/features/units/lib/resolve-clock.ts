/**
 * Soft-join a cron/every Manifest flow to a named clock for Run now.
 *
 * Mirrors the schedule-equality spirit of server `flowIdsForCronRow` —
 * against `manifest.clocks`, not the live CronStore — so Units can resolve
 * without inventing trigger metadata.
 */

import type { Clock, Flow, Manifest } from "../../../../../../manifest/types.ts";

/** Successful soft-join to one Manifest clock. */
export type ClockMatch = {
  readonly kind: "matched";
  readonly clockName: string;
  readonly timezone: string | null;
  readonly description: string | null;
  readonly cron: string | null;
  readonly every: string | null;
};

/** No unique Manifest clock for this flow's schedule. */
export type ClockUnmatched = {
  readonly kind: "unmatched";
};

/** Result of {@link resolveClockForFlow}. */
export type ClockResolveResult = ClockMatch | ClockUnmatched;

/**
 * Resolve a unique Manifest clock for a cron/every-triggered flow.
 *
 * Match order (accumulated, then require uniqueness):
 * 1. Clock name equals flow id, or flow id ends with `.{clockName}`
 * 2. `clock.cron === flow.trigger.cron`
 * 3. `clock.every === flow.trigger.every`
 *
 * Zero or multiple matches → `unmatched` (honest invoke fallback).
 *
 * @param manifest - Live Manifest
 * @param flowId - Flow id
 */
export function resolveClockForFlow(
  manifest: Manifest | null | undefined,
  flowId: string,
): ClockResolveResult {
  const flow: Flow | undefined = manifest?.flows?.[flowId];
  const cron = flow?.trigger?.cron;
  const every = flow?.trigger?.every;
  if (!cron && !every) return { kind: "unmatched" };

  const clocks = manifest?.clocks ?? {};
  const hits = new Set<string>();

  for (const [name, clock] of Object.entries(clocks)) {
    if (flowId === name || flowId.endsWith(`.${name}`)) {
      hits.add(name);
      continue;
    }
    if (cron && clock.cron === cron) {
      hits.add(name);
      continue;
    }
    if (every && clock.every === every) {
      hits.add(name);
    }
  }

  if (hits.size !== 1) return { kind: "unmatched" };
  const clockName = [...hits][0]!;
  const clock: Clock = clocks[clockName]!;
  return {
    kind: "matched",
    clockName,
    timezone: clock.timezone ?? null,
    description: clock.description ?? null,
    cron: clock.cron ?? null,
    every: clock.every ?? null,
  };
}
