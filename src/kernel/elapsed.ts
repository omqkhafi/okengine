/**
 * High-res duration vs injectable wall clock.
 *
 * `clock.now()` / `Date.now()` stay epoch-ms for timestamps, leases, and
 * time-travel. Duration is measured with `performance.now()` so a handler
 * that finishes in the same millisecond is not recorded as 0.
 */

/**
 * Combine a wall-clock delta with a high-res elapsed measurement.
 *
 * Use the app clock when it ticked (real ms, time-travel, injected tests).
 * Use high-res only when the wall clock recorded 0 — the case that used
 * to show `0μs` for a handler that finished in the same millisecond.
 *
 * @param wallMs - `endedAt - startedAt` from the injectable clock
 * @param elapsedMs - `performance.now()` delta over the same span
 */
export function resolveDurationMs(wallMs: number, elapsedMs: number): number {
  const wall = Number.isFinite(wallMs) ? Math.max(0, wallMs) : 0;
  const elapsed = Number.isFinite(elapsedMs) ? Math.max(0, elapsedMs) : 0;
  return wall > 0 ? wall : elapsed;
}
