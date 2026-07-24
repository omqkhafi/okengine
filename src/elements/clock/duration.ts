/**
 * Duration / interval parsing for the Clock element.
 */

/**
 * Parse a short duration string (`"7d"`, `"2m"`, `"30s"`, `"1h"`, `"200ms"`)
 * to milliseconds. Returns `0` when the string is not a duration.
 *
 * @param duration - Duration string
 */
export function parseDurationMs(duration: string): number {
  const match = /^(\d+)(ms|s|m|h|d)$/.exec(duration.trim());
  if (!match) return 0;
  const n = Number(match[1]);
  switch (match[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60_000;
    case "h":
      return n * 3_600_000;
    case "d":
      return n * 86_400_000;
    default:
      return 0;
  }
}
