/**
 * Rows changed by one Bun.SQL `unsafe` result.
 *
 * Bun 1.4.2 returns an array with `count` or `affectedRows` and no `changes`.
 * An empty `UPDATE` is then `length === 0` even when a row was written.
 * Older fakes stamp `changes`. A bare array is a row list.
 *
 * @param result - Driver result
 */
export function affectedRows(result: unknown): number {
  if (result !== null && typeof result === "object") {
    const row = result as { count?: unknown; affectedRows?: unknown; changes?: unknown };
    if (typeof row.count === "number") return row.count;
    if (typeof row.affectedRows === "number") return row.affectedRows;
    if (typeof row.changes === "number") return row.changes;
  }
  return Array.isArray(result) ? result.length : 0;
}
