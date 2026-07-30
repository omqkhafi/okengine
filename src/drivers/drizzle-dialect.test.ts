/**
 * Exhaustive SQL driver → drizzle-kit dialect map.
 */

import { describe, expect, test } from "bun:test";
import { drizzleDialectFromSqlDriver, SQL_DRIVER_TO_DRIZZLE_DIALECT } from "./drizzle-dialect.ts";

describe("SQL_DRIVER_TO_DRIZZLE_DIALECT", () => {
  test("maps owned SQL drivers", () => {
    expect(SQL_DRIVER_TO_DRIZZLE_DIALECT).toEqual({
      sqlite: "sqlite",
      postgres: "postgresql",
      libsql: "sqlite",
      pglite: "postgresql",
    });
  });

  test("drizzleDialectFromSqlDriver resolves", () => {
    expect(drizzleDialectFromSqlDriver("sqlite")).toBe("sqlite");
    expect(drizzleDialectFromSqlDriver("postgres")).toBe("postgresql");
    expect(drizzleDialectFromSqlDriver("libsql")).toBe("sqlite");
    expect(drizzleDialectFromSqlDriver("pglite")).toBe("postgresql");
  });
});
