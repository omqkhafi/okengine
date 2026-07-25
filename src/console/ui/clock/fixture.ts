/**
 * Clock panel fixture for unit + axe tests.
 */

import type { ClockListResponse } from "./types.ts";

const NOW = 1_700_000_000_000;

/** List response covering timeline, waiting-on, health, DST. */
export const CLOCK_LIST_FIXTURE: ClockListResponse = {
  now: NOW,
  crons: [
    {
      name: "expire-holds",
      status: "active",
      timezone: "UTC",
      overridable: true,
      declaredEvery: "10m",
      effectiveEvery: "10m",
      lastRunAt: NOW - 30 * 60_000,
      nextRunAt: NOW - 20 * 60_000,
      health: {
        driftMs: 1_200,
        overdue: true,
        missedRuns: 3,
        catchUp: "one",
        leaderInstanceId: "inst-a",
        leaderLeaseUntil: NOW + 30_000,
      },
      dstAmbiguity: null,
      external: false,
      flowIds: ["holds.expire"],
    },
    {
      name: "nightly",
      status: "active",
      timezone: "America/New_York",
      overridable: false,
      declaredCron: "0 2 * * *",
      effectiveCron: "0 2 * * *",
      lastRunAt: NOW - 86_400_000,
      nextRunAt: NOW + 3_600_000,
      health: {
        driftMs: 0,
        overdue: false,
        missedRuns: 0,
        catchUp: "one",
        leaderInstanceId: "inst-b",
        leaderLeaseUntil: NOW + 15_000,
      },
      dstAmbiguity: {
        kind: "gap",
        reason: "02:00 in America/New_York is skipped on 2024-03-10 (DST spring forward)",
        on: "2024-03-10",
        localTime: "02:00",
      },
      external: true,
      flowIds: ["reports.nightly"],
    },
  ],
  waitingOn: [
    {
      runId: "run_sleep_1",
      flow: "payments.verify",
      label: "verify-window",
      wakeAt: NOW + 120_000,
      wakeInMs: 120_000,
      step: "create-intent",
    },
    {
      runId: "run_sleep_2",
      flow: "trials.start",
      label: "trial-period",
      wakeAt: NOW + 86_400_000,
      wakeInMs: 86_400_000,
      step: null,
    },
    {
      runId: "run_sleep_3",
      flow: "trials.start",
      label: "trial-period",
      wakeAt: NOW + 90_000_000,
      wakeInMs: 90_000_000,
      step: "enroll",
    },
  ],
  waitingOnCounts: [
    { label: "trial-period", count: 2 },
    { label: "verify-window", count: 1 },
  ],
  timeline: [
    {
      at: NOW + 120_000,
      kind: "wake",
      name: "verify-window",
      meta: "run_sleep_1",
    },
    {
      at: NOW + 3_600_000,
      kind: "cron",
      name: "nightly",
      meta: "0 2 * * *",
    },
    {
      at: NOW + 86_400_000 - 1,
      kind: "wake",
      name: "trial-period",
      meta: "run_sleep_2",
    },
  ],
};
