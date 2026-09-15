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
  | BuiltinErrorMap["DatabaseError"]
  | BuiltinErrorMap["ServiceUnavailable"]
>;

type SqlErrShape = {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly errno?: unknown;
  readonly message?: unknown;
  readonly cause?: unknown;
  readonly constraint?: unknown;
  readonly table?: unknown;
  readonly column?: unknown;
  readonly table_name?: unknown;
  readonly column_name?: unknown;
  readonly constraint_name?: unknown;
};

const CONFLICT_STATE = new Set(["23505", "23P01"]);
const FOREIGN_KEY_STATE = new Set(["23503", "23001"]);
const NOT_NULL_STATE = new Set(["23502"]);
const CHECK_STATE = new Set(["23514"]);
const RETRY_STATE = new Set(["40001", "40P01", "55P03"]);
const TOO_LONG_STATE = new Set(["22001"]);
const OUT_OF_RANGE_STATE = new Set(["22003", "22008"]);
const INVALID_STATE = new Set(["22P02", "22007", "22023", "42804"]);
const UNAVAILABLE_STATE = new Set([
  "53300",
  "53100",
  "53200",
  "53400",
  "57P01",
  "57P02",
  "57P03",
  "57P04",
  "57014",
  "25P03",
]);

/** bun:sqlite / libsql busy / locked (leave thrown for retry). */
const SQLITE_RETRY_ERRNO = new Set([5, 6, 261, 517]);
/** bun:sqlite PRIMARYKEY / ROWID unique. */
const SQLITE_CONFLICT_ERRNO = new Set([1555, 2067, 2579]);
const SQLITE_UNAVAILABLE_ERRNO = new Set([8, 10, 13, 14, 15]);

/**
 * True when `err` is a serialization / deadlock / lock-busy failure.
 *
 * Left thrown during retries; mapped to `ServiceUnavailable` after exhaust.
 *
 * @param err - Caught driver error
 */
export function isRetryableSqlError(err: unknown): boolean {
  return walk(err, (node) => retrySignal(node));
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
  const retryable = options.retryable ?? "leave";
  let unknownNode: unknown;
  let current: unknown = err;
  for (let i = 0; i < 4; i++) {
    if (!current || typeof current !== "object") break;
    if (retrySignal(current)) {
      if (retryable === "leave") return undefined;
      return fail.serviceUnavailable();
    }
    if (isConnectionUnavailable(current)) return fail.serviceUnavailable();
    const mapped = mapConstraint(current);
    if (mapped) return mapped;
    if (unknownNode === undefined && looksLikeSqlError(current)) unknownNode = current;
    current = causeOf(current);
  }
  if (unknownNode !== undefined) {
    return fail.database({ reason: "unknown", ...publicNames(unknownNode) });
  }
  return undefined;
}

function mapConstraint(err: unknown): SqlFailure | undefined {
  const code = sqlCode(err);
  const names = publicNames(err);

  if (CONFLICT_STATE.has(code)) return fail.conflict(names);
  if (FOREIGN_KEY_STATE.has(code)) return fail.foreignKey(names);
  if (NOT_NULL_STATE.has(code)) return fail.database({ reason: "not_null", ...names });
  if (CHECK_STATE.has(code)) return fail.database({ reason: "check", ...names });
  if (TOO_LONG_STATE.has(code)) return fail.database({ reason: "too_long", ...names });
  if (OUT_OF_RANGE_STATE.has(code)) return fail.database({ reason: "out_of_range", ...names });
  if (INVALID_STATE.has(code)) return fail.database({ reason: "invalid", ...names });

  const sqlite = sqliteConstraint(err);
  if (sqlite === "unique") return fail.conflict(names);
  if (sqlite === "fk") return fail.foreignKey(names);
  if (sqlite === "not_null") return fail.database({ reason: "not_null", ...names });
  if (sqlite === "check") return fail.database({ reason: "check", ...names });

  return undefined;
}

function retrySignal(err: unknown): boolean {
  const code = sqlCode(err);
  if (RETRY_STATE.has(code)) return true;
  const errno = sqlErrno(err);
  if (errno !== undefined && SQLITE_RETRY_ERRNO.has(errno)) return true;
  const named = sqlCode(err);
  if (named === "SQLITE_BUSY" || named === "SQLITE_LOCKED" || named === "SQLITE_BUSY_SNAPSHOT") {
    return true;
  }
  return false;
}

function isConnectionUnavailable(err: unknown): boolean {
  const e = err as SqlErrShape;
  const code = sqlCode(err);
  if (code.startsWith("08")) return true;
  if (code.startsWith("53")) return true;
  if (UNAVAILABLE_STATE.has(code)) return true;
  if (code.startsWith("ERR_POSTGRES_")) return true;
  if (code === "ERR_OKE_POSTGRES_PAUSED") return true;
  if (typeof e.name === "string" && e.name === "SharedPostgresPausedError") return true;
  const errno = sqlErrno(err);
  if (errno !== undefined && SQLITE_UNAVAILABLE_ERRNO.has(errno)) return true;
  if (code === "SQLITE_READONLY" || code === "SQLITE_FULL" || code === "SQLITE_CANTOPEN") {
    return true;
  }
  const message = typeof e.message === "string" ? e.message : "";
  if (/postgres pools are paused/i.test(message)) return true;
  return false;
}

function looksLikeSqlError(err: unknown): boolean {
  const e = err as SqlErrShape;
  const code = sqlCode(err);
  if (/^[0-9A-Z]{5}$/.test(code)) return true;
  if (code.startsWith("SQLITE_")) return true;
  if (typeof e.name === "string" && /postgres|sqlite|pglite|libsql/i.test(e.name)) return true;
  const message = typeof e.message === "string" ? e.message : "";
  return /sqlstate|constraint|syntax error/i.test(message);
}

function sqlCode(err: unknown): string {
  if (!err || typeof err !== "object") return "";
  const code = (err as SqlErrShape).code;
  return typeof code === "string" ? code : "";
}

function sqlErrno(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const errno = (err as SqlErrShape).errno;
  return typeof errno === "number" ? errno : undefined;
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
    /(?:UNIQUE|NOT NULL|PRIMARY KEY) constraint failed:\s*([A-Za-z_][\w]*)\.([A-Za-z_][\w]*)/i.exec(
      message,
    );
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
  const errno = sqlErrno(err);
  const code = sqlCode(err);
  if (
    (errno !== undefined && SQLITE_CONFLICT_ERRNO.has(errno)) ||
    code === "SQLITE_CONSTRAINT_UNIQUE" ||
    code === "SQLITE_CONSTRAINT_PRIMARYKEY" ||
    /UNIQUE constraint failed/i.test(message) ||
    /PRIMARY KEY constraint failed/i.test(message)
  ) {
    return "unique";
  }
  if (
    errno === 787 ||
    code === "SQLITE_CONSTRAINT_FOREIGNKEY" ||
    /FOREIGN KEY constraint failed/i.test(message)
  ) {
    return "fk";
  }
  if (
    errno === 1299 ||
    code === "SQLITE_CONSTRAINT_NOTNULL" ||
    /NOT NULL constraint failed/i.test(message)
  ) {
    return "not_null";
  }
  if (
    errno === 275 ||
    code === "SQLITE_CONSTRAINT_CHECK" ||
    /CHECK constraint failed/i.test(message)
  ) {
    return "check";
  }
  return undefined;
}

function causeOf(err: unknown): unknown {
  if (!err || typeof err !== "object") return undefined;
  return (err as SqlErrShape).cause;
}

function walk(err: unknown, pred: (node: unknown) => boolean): boolean {
  let current: unknown = err;
  for (let i = 0; i < 4; i++) {
    if (pred(current)) return true;
    current = causeOf(current);
    if (current === undefined) break;
  }
  return false;
}
