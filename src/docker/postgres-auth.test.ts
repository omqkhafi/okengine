/**
 * Postgres leftover-volume password detection.
 */

import { describe, expect, test } from "bun:test";
import { isPostgresPasswordAuthFailure } from "./postgres-auth.ts";

describe("isPostgresPasswordAuthFailure", () => {
  test("matches the official Postgres rejection", () => {
    expect(
      isPostgresPasswordAuthFailure(new Error('password authentication failed for user "oke"')),
    ).toBe(true);
    expect(isPostgresPasswordAuthFailure("the database system is starting up")).toBe(false);
    expect(isPostgresPasswordAuthFailure("ECONNREFUSED")).toBe(false);
  });
});
