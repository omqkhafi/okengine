/**
 * Constant-time equality for auth secrets (OTP, claim codes, challenges).
 */

/**
 * Constant-time string equality (UTF-16 code units).
 * Length mismatches still scan to `max(len)` so timing does not leak length
 * beyond the longer operand.
 *
 * @param a - Expected
 * @param b - Candidate
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const len = Math.max(a.length, b.length);
  let mismatch = a.length === b.length ? 0 : 1;
  for (let i = 0; i < len; i++) {
    const ac = a.charCodeAt(i) || 0;
    const bc = b.charCodeAt(i) || 0;
    mismatch |= ac ^ bc;
  }
  return mismatch === 0;
}
