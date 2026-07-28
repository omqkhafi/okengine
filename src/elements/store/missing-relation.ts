/**
 * Detect driver-specific "table/column does not exist" errors.
 *
 * Matches exact signatures per driver — not a generic substring hunt.
 */

/**
 * Whether `err` is a missing-relation / missing-column error from a SQL driver.
 *
 * @param err - Caught value from `query` / `exec`
 */
export function isMissingDomainRelationError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as {
    readonly name?: unknown;
    readonly message?: unknown;
    readonly code?: unknown;
  };
  const message = typeof e.message === "string" ? e.message : "";
  const code = typeof e.code === "string" ? e.code : "";
  const name = typeof e.name === "string" ? e.name : "";

  // Postgres (Bun.SQL) + PGlite — SQLSTATE undefined_table / undefined_column.
  // Never treat ERR_POSTGRES_* connection codes as schema-missing.
  if (code === "42P01" || code === "42703") return true;

  // bun:sqlite — name + message prefix (errno 1 alone is SQLITE_ERROR, too broad).
  if (name === "SQLiteError") {
    return /^no such table:/i.test(message) || /^no such column:/i.test(message);
  }

  // In-memory SQL driver used in tests (`new Error("no such table: …")`).
  if (name === "Error" || name === "") {
    return /^no such table:/i.test(message);
  }

  return false;
}
