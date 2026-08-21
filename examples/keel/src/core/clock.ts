/**
 * Keel clocks.
 */

import { clock } from "okengine";

/** Expire stale compose drafts. */
export const expireDraftsClock = clock("expire-drafts", {
  every: "10m",
  timezone: "UTC",
  overridable: true,
  description: "Expire stale compose drafts",
});

/** Scan overdue tasks. */
export const watchOverdueClock = clock("watch-overdue", {
  every: "15m",
  timezone: "UTC",
  description: "Scan overdue tasks",
});

/** Morning inbox + goal digest. */
export const dailyDigestClock = clock("daily-digest", {
  cron: "0 8 * * *",
  every: "1d",
  timezone: "UTC",
  description: "Morning inbox + goal digest",
});

/** Spawn recurring task occurrences. */
export const spawnRecurringClock = clock("spawn-recurring", {
  every: "1h",
  timezone: "UTC",
  description: "Spawn recurring task occurrences",
});

/** Weekly goal rollup. */
export const rollupGoalsClock = clock("rollup-goals", {
  cron: "0 9 * * 1",
  every: "7d",
  timezone: "UTC",
  description: "Weekly goal rollup",
});
