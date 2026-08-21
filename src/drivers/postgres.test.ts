/**
 * Postgres placeholder conversion.
 */

import { describe, expect, test } from "bun:test";
import { toPostgresParams } from "./postgres.ts";

describe("toPostgresParams", () => {
  test("rewrites ? only when values are bound", () => {
    expect(toPostgresParams("SELECT * FROM t WHERE id = ?", ["a"])).toBe(
      "SELECT * FROM t WHERE id = $1",
    );
    expect(toPostgresParams("INSERT INTO t (a, b) VALUES (?, ?)", [1, 2])).toBe(
      "INSERT INTO t (a, b) VALUES ($1, $2)",
    );
  });

  test("leaves jsonb ? operators unchanged when there are no values", () => {
    const sql = "SELECT current_setting('oke.scopes', true)::jsonb ? p_scope";
    expect(toPostgresParams(sql)).toBe(sql);
    expect(toPostgresParams(sql, [])).toBe(sql);
  });
});
