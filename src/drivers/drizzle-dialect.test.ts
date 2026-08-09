/**
 * Exhaustive SQL driver → drizzle-kit dialect map.
 */

import { describe, expect, test } from "bun:test";
import { drizzleDialectFromSqlDriver, SQL_DRIVER_TO_DRIZZLE_DIALECT } from "./drizzle-dialect.ts";

describe("SQL_DRIVER_TO_DRIZZLE_DIALECT", () => {
  test("maps owned SQL drivers", () => {
    expect(SQL_DRIVER_TO_DRIZZLE_DIALECT).toEqual({
      postgres: "postgresql",
      pglite: "postgresql",
    });
  });

  test("drizzleDialectFromSqlDriver resolves", () => {
    expect(drizzleDialectFromSqlDriver("postgres")).toBe("postgresql");
    expect(drizzleDialectFromSqlDriver("pglite")).toBe("postgresql");
  });
});
