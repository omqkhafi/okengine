/**
 * Reverse readers / writers helpers for Store detail.
 */

/**
 * Dedupe + sort flow ids for a stable "touched by" list.
 *
 * @param ids - Reader or writer flow ids from the store list child
 */
export function sortedFlowIds(ids: readonly string[]): string[] {
  return [...new Set(ids)].sort((a, b) => a.localeCompare(b));
}
