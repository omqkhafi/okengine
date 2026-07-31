/**
 * Sliding-window rate limit for auth credential checks.
 *
 * Shared strategy with Console operator login (5 / 60s).
 */

/** Max attempts per window. */
export const AUTH_RATE_LIMIT = 5;

/** Rate-limit window. */
export const AUTH_RATE_WINDOW_MS = 60 * 1000;

/**
 * Record an attempt and return whether the key is still under the limit.
 *
 * @param attempts - Sliding timestamps for one key
 * @param now - Epoch-ms
 * @param limit - Max attempts
 * @param windowMs - Window length
 */
export function touchRateLimit(
  attempts: number[],
  now: number,
  limit: number = AUTH_RATE_LIMIT,
  windowMs: number = AUTH_RATE_WINDOW_MS,
): "ok" | "rate_limited" {
  while (attempts.length > 0 && attempts[0]! <= now - windowMs) {
    attempts.shift();
  }
  if (attempts.length >= limit) {
    return "rate_limited";
  }
  attempts.push(now);
  return "ok";
}

/** Per-key attempt bags (email → timestamps). */
export type LoginAttemptBag = Map<string, number[]>;

/**
 * Create an empty login attempt bag.
 */
export function createLoginAttemptBag(): LoginAttemptBag {
  return new Map();
}
