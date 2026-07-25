/**
 * Sliding-window rate limit for Console credential checks (console §10.4).
 *
 * Shared by setup-claim and operator login so both surfaces use the same
 * strategy: 5 attempts / 60s, keyed in memory for the process lifetime.
 */

/** Max verification attempts per window. */
export const AUTH_RATE_LIMIT = 5;

/** Rate-limit window. */
export const AUTH_RATE_WINDOW_MS = 60 * 1000;

/**
 * Record an attempt and return whether the key is still under the limit.
 *
 * Mutates `attempts` by dropping timestamps outside the window, then appending
 * `now` when under the limit. Callers that are rate-limited do not append.
 *
 * @param attempts - Sliding timestamps for one key (email / claim bucket)
 * @param now - Epoch-ms
 * @param limit - Max attempts (default {@link AUTH_RATE_LIMIT})
 * @param windowMs - Window length (default {@link AUTH_RATE_WINDOW_MS})
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

/**
 * Per-key attempt bags for operator login (email → timestamps).
 */
export type LoginAttemptBag = Map<string, number[]>;

/**
 * Create an empty login attempt bag.
 */
export function createLoginAttemptBag(): LoginAttemptBag {
  return new Map();
}

/**
 * Rate-limit an operator login attempt for `email`.
 *
 * @param bag - Per-email attempt map
 * @param email - Submitted email (normalized)
 * @param now - Epoch-ms
 */
export function touchLoginRateLimit(
  bag: LoginAttemptBag,
  email: string,
  now: number,
): "ok" | "rate_limited" {
  const key = email.trim().toLowerCase();
  let attempts = bag.get(key);
  if (!attempts) {
    attempts = [];
    bag.set(key, attempts);
  }
  return touchRateLimit(attempts, now);
}
