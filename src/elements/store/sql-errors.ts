/**
 * Map driver SQL errors to typed {@link FlowFailure} values.
 *
 * Lives on the store path — not the kernel edge graph. Public payloads are
 * names only (constraint / table / column / sqlstate). Never copy
 * `message` / `detail` / `hint`.
 */

import { fail } from "../../kernel/fail-helpers.ts";
import type { FlowFailure } from "../../kernel/errors.ts";
import type { BuiltinErrorMap } from "../../kernel/builtin-errors.ts";

/** How to treat serialization / deadlock SQLSTATE (`40001` / `40P01`). */
export type SqlRetryableMode = "leave" | "unavailable";

/** Options for {@link sqlErrorToFailure}. */
export interface SqlErrorToFailureOptions {
  /**
   * `leave` — return `undefined` so {@link flow.retry} can rethrow.
   * `unavailable` — map to `ServiceUnavailable` after retries exhaust.
   */
  readonly retryable?: SqlRetryableMode;
}

type SqlFailure = FlowFailure<
  | BuiltinErrorMap["Conflict"]
  | BuiltinErrorMap["ForeignKey"]
  | BuiltinErrorMap["DatabaseError"]
  | BuiltinErrorMap["ServiceUnavailable"]
>;

type SqlErrShape = {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly message?: unknown;
  readonly constraint?: unknown;
  readonly table?: unknown;
  readonly column?: unknown;
  readonly table_name?: unknown;
  readonly column_name?: unknown;
  readonly constraint_name?: unknown;
};

/**
 * True when `err` is a Postgres serialization / deadlock failure.
 *
 * Left thrown during retries; mapped to `ServiceUnavailable` after exhaust.
 *
 * @param err - Caught driver error
 */
export function isRetryableSqlError(err: unknown): boolean {
  const code = sqlCode(err);
  return code === "40001" || code === "40P01";
}

/**
 * Map a driver SQL error to a typed failure, or `undefined` when it is not a
 * SQL constraint / connection failure (or is retryable under `leave`).
 *
 * @param err - Caught value from `query` / `exec`
 * @param options - Retryable handling
 */
export function sqlErrorToFailure(
  err: unknown,
  options: SqlErrorToFailureOptions = {},
): SqlFailure | undefined {
  if (!err || typeof err !== "object") return undefined;
  const retryable = options.retryable ?? "leave";

  if (isRetryableSqlError(err)) {
    if (retryable === "leave") return undefined;
    return fail.serviceUnavailable();
  }

  if (isConnectionUnavailable(err)) {
    return fail.serviceUnavailable();
  }

  const mapped = mapConstraint(err);
  if (mapped) return mapped;

  if (looksLikeSqlError(err)) {
    return fail.database({ reason: "unknown", ...publicNames(err) });
  }

  return undefined;
}

function mapConstraint(err: unknown): SqlFailure | undefined {
  const code = sqlCode(err);
  const names = publicNames(err);

  if (code === "23505" || code === "23P01") {
    return fail.conflict(names);
  }
  if (code === "23503") {
    return fail.foreignKey(names);
  }
  if (code === "23502") {
    return fail.database({ reason: "not_null", ...names });
  }
  if (code === "23514") {
    return fail.database({ reason: "check", ...names });
  }

  const sqlite = sqliteConstraint(err);
  if (sqlite === "unique") return fail.conflict(names);
  if (sqlite === "fk") return fail.foreignKey(names);
  if (sqlite === "not_null") return fail.database({ reason: "not_null", ...names });
  if (sqlite === "check") return fail.database({ reason: "check", ...names });

  return undefined;
}

function isConnectionUnavailable(err: unknown): boolean {
  const e = err as SqlErrShape;
  const code = sqlCode(err);
  if (code.startsWith("08")) return true;
  if (code === "53300") return true;
  if (code.startsWith("ERR_POSTGRES_")) return true;
  if (code === "ERR_OKE_POSTGRES_PAUSED") return true;
  if (typeof e.name === "string" && e.name === "SharedPostgresPausedError") return true;
  const message = typeof e.message === "string" ? e.message : "";
  if (/postgres pools are paused/i.test(message)) return true;
  return false;
}

function looksLikeSqlError(err: unknown): boolean {
  const e = err as SqlErrShape;
  const code = sqlCode(err);
  if (/^[0-9A-Z]{5}$/.test(code)) return true;
  if (typeof e.name === "string" && /postgres|sqlite|pglite/i.test(e.name)) return true;
  const message = typeof e.message === "string" ? e.message : "";
  return /sqlstate|constraint|syntax error/i.test(message);
}

function sqlCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const code = (err as SqlErrShape).code;
  return typeof code === "string" ? code : "";
}

function publicNames(err: unknown): {
  readonly sqlstate?: string;
  readonly constraint?: string;
  readonly table?: string;
  readonly column?: string;
} {
  const e = err as SqlErrShape;
  const sqlstate = sqlCode(err);
  const constraint = firstString(e.constraint, e.constraint_name);
  const table = firstString(e.table, e.table_name);
  const column = firstString(e.column, e.column_name);
  const fromMessage = parseSqliteNames(typeof e.message === "string" ? e.message : "");
  const out: {
    sqlstate?: string;
    constraint?: string;
    table?: string;
    column?: string;
  } = {};
  if (/^[0-9A-Z]{5}$/.test(sqlstate)) out.sqlstate = sqlstate;
  const constraintName = constraint ?? fromMessage.constraint;
  if (constraintName) out.constraint = constraintName;
  const tableName = table ?? fromMessage.table;
  const columnName = column ?? fromMessage.column;
  if (tableName) out.table = tableName;
  if (columnName) out.column = columnName;
  return out;
}

function firstString(...values: readonly unknown[]): string | undefined {
  for (const v of values) {
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

function parseSqliteNames(message: string): {
  table?: string;
  column?: string;
  constraint?: string;
} {
  const dotted =
    /(?:UNIQUE|NOT NULL) constraint failed:\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/i.exec(message);
  if (dotted?.[1] && dotted[2]) {
    return { table: dotted[1], column: dotted[2] };
  }
  const check = /CHECK constraint failed:\s*([A-Za-z_][\w]*)/i.exec(message);
  if (check?.[1]) return { constraint: check[1] };
  return {};
}

type SqliteKind = "unique" | "fk" | "not_null" | "check";

function sqliteConstraint(err: unknown): SqliteKind | undefined {
  const e = err as SqlErrShape;
  const message = typeof e.message === "string" ? e.message : "";
  const errno = typeof e.errno === "number" ? e.errno : undefined;
  // bun:sqlite extended codes: UNIQUE 2067, FOREIGNKEY 787, NOTNULL 1299, CHECK 275.
  if (errno === 2067 || /UNIQUE constraint failed/i.test(message)) return "unique";
  if (errno === 787 || /FOREIGN KEY constraint failed/i.test(message)) return "fk";
  if (errno === 1299 || /NOT NULL constraint failed/i.test(message)) return "not_null";
  if (errno === 275 || /CHECK constraint failed/i.test(message)) return "check";
  return undefined;
}
