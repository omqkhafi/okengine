/**
 * Contextual duration formatting for Traces rows.
 *
 * Sub-millisecond → microseconds, mid-range → milliseconds,
 * slow runs → seconds — matching the reference Traces density pattern.
 */

/**
 * Format a duration in milliseconds into a compact display string.
 *
 * @param ms - Duration in milliseconds (may be fractional for sub-ms runs)
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0μs";
  if (ms < 1) {
    return `${Math.round(ms * 1_000)}μs`;
  }
  if (ms < 1_000) {
    const rounded = Math.round(ms * 10) / 10;
    return Number.isInteger(rounded) ? `${rounded}ms` : `${rounded.toFixed(1)}ms`;
  }
  const seconds = ms / 1_000;
  const rounded = Math.round(seconds * 10) / 10;
  return Number.isInteger(rounded) ? `${rounded}s` : `${rounded.toFixed(1)}s`;
}
