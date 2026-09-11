/**
 * Keel clocks.
 */

import { clock } from "okengine";

/** Expire stale compose drafts. */
export const expireDraftsClock = clock.every("expire-drafts", "10m", {
  timezone: "UTC",
  overridable: true,
  description: "Expire stale compose drafts",
});

/** Scan overdue tasks. */
export const watchOverdueClock = clock.every("watch-overdue", "15m", {
  timezone: "UTC",
  description: "Scan overdue tasks",
});

/** Morning inbox + goal digest. */
export const dailyDigestClock = clock.daily("daily-digest", {
  at: "08:00",
  timezone: "UTC",
  description: "Morning inbox + goal digest",
});

/** Spawn recurring task occurrences. */
export const spawnRecurringClock = clock.every("spawn-recurring", "1h", {
  timezone: "UTC",
  description: "Spawn recurring task occurrences",
});

/** Weekly goal rollup. */
export const rollupGoalsClock = clock.weekly("rollup-goals", {
  on: "mon",
  at: "09:00",
  timezone: "UTC",
  description: "Weekly goal rollup",
});
