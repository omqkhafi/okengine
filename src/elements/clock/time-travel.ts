/**
 * Frozen / time-travel clock for deterministic tests.
 *
 * ```ts
 * const t = createTimeTravel(0);
 * await durableSleep(...);          // parks
 * t.advance("7d");                  // sleep elapses instantly
 * await resume(...);
 * ```
 */

import { parseDurationMs } from "./duration.ts";

/** Injectable frozen clock with advance. */
export interface TimeTravel {
  /** Current frozen epoch-ms. */
  now(): number;
  /**
   * Advance the frozen clock by a duration string or milliseconds.
   *
   * @param by - `"7d"` / `"2m"` / milliseconds
   */
  advance(by: string | number): number;
  /**
   * Jump to an absolute epoch-ms.
   *
   * @param ms - Absolute time
   */
  set(ms: number): number;
}

/**
 * Create a frozen clock starting at `start` (default `0`).
 *
 * @param start - Initial epoch-ms
 */
export function createTimeTravel(start = 0): TimeTravel {
  let current = start;
  return {
    now() {
      return current;
    },
    advance(by) {
      const ms = typeof by === "number" ? by : parseDurationMs(by);
      current += ms;
      return current;
    },
    set(ms) {
      current = ms;
      return current;
    },
  };
}
