/**
 * SQLSTATE / SQLite constraint → typed FlowFailure.
 */

import { describe, expect, test } from "bun:test";
import { isFlowFailure } from "../../kernel/hooks.ts";
import { isRetryableSqlError, sqlErrorToFailure } from "./sql-errors.ts";

describe("sqlErrorToFailure", () => {
  test("unique / exclusion → Conflict  without copying message", () => {
    const unique = sqlErrorToFailure({
      code: "23505",
      message: 'duplicate key value violates unique constraint "users_email_key"',
      detail: "Key (email)=(a@b.c) already exists.",
      constraint: "users_email_key",
      table: "users",
      column: "email",
    });
    expect(unique?.error.code).toBe("Conflict");
    expect(unique?.error.data).toEqual({
      sqlstate: "23505",
      constraint: "users_email_key",
      table: "users",
      column: "email",
    });
    expect(JSON.stringify(unique)).not.toContain("already exists");
    expect(JSON.stringify(unique)).not.toContain("a@b.c");

    const exclusion = sqlErrorToFailure({ code: "23P01", constraint: "no_overlap" });
    expect(exclusion?.error.code).toBe("Conflict");
  });

  test("restrict / restrict_violation → ForeignKey", () => {
    expect(sqlErrorToFailure({ code: "23001", table: "notes" })?.error.code).toBe("ForeignKey");
  });

  test("invalid / too_long / out_of_range → DatabaseError 422 reasons", () => {
    expect(sqlErrorToFailure({ code: "22P02" })?.error.data).toMatchObject({
      reason: "invalid",
      sqlstate: "22P02",
    });
    expect(sqlErrorToFailure({ code: "22007" })?.error.data).toMatchObject({ reason: "invalid" });
    expect(sqlErrorToFailure({ code: "22023" })?.error.data).toMatchObject({ reason: "invalid" });
    expect(sqlErrorToFailure({ code: "42804" })?.error.data).toMatchObject({ reason: "invalid" });
    expect(sqlErrorToFailure({ code: "22001", column: "title" })?.error.data).toMatchObject({
      reason: "too_long",
      column: "title",
    });
    expect(sqlErrorToFailure({ code: "22003" })?.error.data).toMatchObject({
      reason: "out_of_range",
    });
    expect(sqlErrorToFailure({ code: "22008" })?.error.data).toMatchObject({
      reason: "out_of_range",
    });
  });

  test("walks Drizzle .cause for unique SQLSTATE", () => {
    const wrapped = {
      message: "Failed query: insert into users constraint users_email_key",
      cause: {
        code: "23505",
        constraint: "users_email_key",
        message: 'duplicate key value violates unique constraint "users_email_key"',
      },
    };
    const mapped = sqlErrorToFailure(wrapped);
    expect(mapped?.error.code).toBe("Conflict");
    expect(mapped?.error.data).toMatchObject({ constraint: "users_email_key", sqlstate: "23505" });
    expect(JSON.stringify(mapped)).not.toContain("duplicate key");
  });

  test("foreign key → ForeignKey", () => {
    const fk = sqlErrorToFailure({
      code: "23503",
      table: "notes",
      constraint: "notes_user_id_fkey",
      message: 'insert or update on table "notes" violates foreign key constraint',
    });
    expect(fk?.error.code).toBe("ForeignKey");
    expect(fk?.error.data).toMatchObject({
      sqlstate: "23503",
      table: "notes",
      constraint: "notes_user_id_fkey",
    });
    expect(JSON.stringify(fk)).not.toContain("violates");
  });

  test("not_null / check → DatabaseError reasons", () => {
    const notNull = sqlErrorToFailure({ code: "23502", column: "title", table: "posts" });
    expect(notNull?.error.code).toBe("DatabaseError");
    expect(notNull?.error.data).toMatchObject({ reason: "not_null", column: "title" });

    const check = sqlErrorToFailure({ code: "23514", constraint: "positive_clicks" });
    expect(check?.error.code).toBe("DatabaseError");
    expect(check?.error.data).toMatchObject({ reason: "check", constraint: "positive_clicks" });
  });

  test("40001 / 40P01 left thrown until retryable: unavailable", () => {
    const ser = { code: "40001", message: "could not serialize access" };
    expect(isRetryableSqlError(ser)).toBe(true);
    expect(sqlErrorToFailure(ser, { retryable: "leave" })).toBeUndefined();
    const exhausted = sqlErrorToFailure(ser, { retryable: "unavailable" });
    expect(exhausted?.error.code).toBe("ServiceUnavailable");
    expect(JSON.stringify(exhausted)).not.toContain("serialize");

    expect(sqlErrorToFailure({ code: "40P01" }, { retryable: "leave" })).toBeUndefined();
    expect(sqlErrorToFailure({ code: "40P01" }, { retryable: "unavailable" })?.error.code).toBe(
      "ServiceUnavailable",
    );
    expect(isRetryableSqlError({ code: "55P03" })).toBe(true);
    expect(sqlErrorToFailure({ code: "55P03" }, { retryable: "leave" })).toBeUndefined();
    expect(sqlErrorToFailure({ code: "55P03" }, { retryable: "unavailable" })?.error.code).toBe(
      "ServiceUnavailable",
    );
  });

  test("connection / paused → ServiceUnavailable", () => {
    expect(sqlErrorToFailure({ code: "08006" })?.error.code).toBe("ServiceUnavailable");
    expect(sqlErrorToFailure({ code: "53300" })?.error.code).toBe("ServiceUnavailable");
    expect(sqlErrorToFailure({ code: "53100" })?.error.code).toBe("ServiceUnavailable");
    expect(sqlErrorToFailure({ code: "57P01" })?.error.code).toBe("ServiceUnavailable");
    expect(sqlErrorToFailure({ code: "57014" })?.error.code).toBe("ServiceUnavailable");
    expect(sqlErrorToFailure({ code: "25P03" })?.error.code).toBe("ServiceUnavailable");
    expect(sqlErrorToFailure({ code: "ERR_POSTGRES_CONNECTION_CLOSED" })?.error.code).toBe(
      "ServiceUnavailable",
    );
    expect(
      sqlErrorToFailure({ name: "SharedPostgresPausedError", code: "ERR_OKE_POSTGRES_PAUSED" })
        ?.error.code,
    ).toBe("ServiceUnavailable");
  });

  test("sqlite UNIQUE / FK / NOT NULL / CHECK", () => {
    const unique = sqlErrorToFailure({
      name: "SQLiteError",
      message: "UNIQUE constraint failed: users.email",
      errno: 2067,
    });
    expect(unique?.error.code).toBe("Conflict");
    expect(unique?.error.data).toMatchObject({ table: "users", column: "email" });

    const fk = sqlErrorToFailure({
      name: "SQLiteError",
      message: "FOREIGN KEY constraint failed",
      errno: 787,
    });
    expect(fk?.error.code).toBe("ForeignKey");

    const notNull = sqlErrorToFailure({
      name: "SQLiteError",
      message: "NOT NULL constraint failed: posts.title",
    });
    expect(notNull?.error.data).toMatchObject({
      reason: "not_null",
      table: "posts",
      column: "title",
    });

    const check = sqlErrorToFailure({
      name: "SQLiteError",
      message: "CHECK constraint failed: positive_clicks",
    });
    expect(check?.error.data).toMatchObject({ reason: "check", constraint: "positive_clicks" });

    const pk = sqlErrorToFailure({
      name: "SQLiteError",
      message: "PRIMARY KEY constraint failed: users.id",
      errno: 1555,
    });
    expect(pk?.error.code).toBe("Conflict");
    expect(pk?.error.data).toMatchObject({ table: "users", column: "id" });
  });

  test("sqlite busy left thrown until retryable: unavailable", () => {
    const busy = {
      name: "SQLiteError",
      code: "SQLITE_BUSY",
      errno: 5,
      message: "database is locked",
    };
    expect(isRetryableSqlError(busy)).toBe(true);
    expect(sqlErrorToFailure(busy, { retryable: "leave" })).toBeUndefined();
    expect(sqlErrorToFailure(busy, { retryable: "unavailable" })?.error.code).toBe(
      "ServiceUnavailable",
    );
  });

  test("unknown SQLSTATE → DatabaseError unknown; non-SQL stays undefined", () => {
    const other = sqlErrorToFailure({ code: "22012", message: "division by zero" });
    expect(other?.error.code).toBe("DatabaseError");
    expect(other?.error.data).toMatchObject({ reason: "unknown", sqlstate: "22012" });
    expect(JSON.stringify(other)).not.toContain("division");

    expect(sqlErrorToFailure(new Error("boom"))).toBeUndefined();
    expect(isFlowFailure(sqlErrorToFailure({ code: "23505" }))).toBe(true);
  });
});
