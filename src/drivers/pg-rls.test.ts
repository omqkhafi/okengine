import { describe, expect, test } from "bun:test";
import {
  buildAlterPolicySql,
  buildCreatePolicySql,
  parseSqlPolicySpec,
  sqlPolicyRowId,
} from "./pg-rls.ts";

describe("parseSqlPolicySpec", () => {
  test("builds CREATE POLICY SQL", () => {
    const spec = parseSqlPolicySpec({
      name: "read_all",
      table: "bookings",
      command: "SELECT",
      behavior: "PERMISSIVE",
      roles: "public",
      using: "true",
    });
    expect(buildCreatePolicySql(spec)).toBe(
      'CREATE POLICY "read_all" ON "bookings" AS PERMISSIVE FOR SELECT TO public USING (true)',
    );
    expect(sqlPolicyRowId(spec.table, spec.name)).toBe("bookings:read_all");
  });

  test("accepts grid column names for behavior and WITH CHECK", () => {
    const spec = parseSqlPolicySpec({
      name: "write_own",
      table: "comments",
      command: "UPDATE",
      permissive: "RESTRICTIVE",
      roles: "public",
      using: "true",
      with_check: "true",
    });
    expect(spec.behavior).toBe("RESTRICTIVE");
    expect(spec.withCheck).toBe("true");
  });

  test("rejects stacked statements in USING", () => {
    expect(() =>
      parseSqlPolicySpec({
        name: "x",
        table: "bookings",
        using: "true; drop table bookings",
      }),
    ).toThrow("invalid USING");
  });
});

describe("buildAlterPolicySql", () => {
  test("alters USING and roles", () => {
    expect(
      buildAlterPolicySql({
        name: "read_all",
        table: "comments",
        roles: ["public"],
        using: "false",
      }),
    ).toBe('ALTER POLICY "read_all" ON "comments" TO public USING (false)');
  });

  test("rejects stacked statements in USING", () => {
    expect(() =>
      buildAlterPolicySql({
        name: "read_all",
        table: "comments",
        using: "true; drop table comments",
      }),
    ).toThrow("invalid USING");
  });
});
