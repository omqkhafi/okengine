/**
 * ISO-8601 UTC instant from a Console clock reading (epoch ms).
 *
 * Mutation receipts (`clock.run-now`, store edit, vault write, …) return
 * this instead of a raw millisecond number so Call API JSON is readable.
 *
 * @param ms - Epoch milliseconds from `state.now()` / `Date.now()`
 */
export function isoAt(ms: number): string {
  return new Date(ms).toISOString();
}
