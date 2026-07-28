/**
 * Per-driver missing table/column signature matcher.
 */

import { describe, expect, test } from "bun:test";
import { isMissingDomainRelationError } from "./missing-relation.ts";

describe("isMissingDomainRelationError", () => {
  test("postgres SQLSTATE 42P01 / 42703", () => {
    expect(
      isMissingDomainRelationError({
        name: "PostgresError",
        code: "42P01",
        message: 'relation "notes" does not exist',
      }),
    ).toBe(true);
    expect(
      isMissingDomainRelationError({
        name: "PostgresError",
        code: "42703",
        message: 'column "body" does not exist',
      }),
    ).toBe(true);
  });

  test("does not match Bun connection ERR_POSTGRES_* codes", () => {
    expect(
      isMissingDomainRelationError({
        name: "PostgresError",
        code: "ERR_POSTGRES_CONNECTION_CLOSED",
        message: "Connection closed",
      }),
    ).toBe(false);
  });

  test("pglite SQLSTATE shapes", () => {
    expect(
      isMissingDomainRelationError({
        name: "error",
        code: "42P01",
        message: 'relation "definitely_missing" does not exist',
      }),
    ).toBe(true);
    expect(
      isMissingDomainRelationError({
        name: "error",
        code: "42703",
        message: 'column "nope" does not exist',
      }),
    ).toBe(true);
  });

  test("sqlite SQLiteError message prefixes", () => {
    expect(
      isMissingDomainRelationError({
        name: "SQLiteError",
        message: "no such table: definitely_missing",
        errno: 1,
      }),
    ).toBe(true);
    expect(
      isMissingDomainRelationError({
        name: "SQLiteError",
        message: "no such column: nope",
        errno: 1,
      }),
    ).toBe(true);
  });

  test("sqlite errno alone is not enough", () => {
    expect(
      isMissingDomainRelationError({
        name: "SQLiteError",
        message: "constraint failed",
        errno: 1,
      }),
    ).toBe(false);
  });

  test("memory driver no such table", () => {
    expect(isMissingDomainRelationError(new Error("no such table: notes"))).toBe(true);
  });
});
