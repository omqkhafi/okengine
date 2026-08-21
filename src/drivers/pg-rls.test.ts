import { describe, expect, test } from "bun:test";
import {
  buildAlterPolicySql,
  buildCreatePolicySql,
  buildRlsIdentityPreludeSql,
  emitPgPolicySource,
  formatPolicyRole,
  OKE_RLS_HELPER_STATEMENTS,
  OKE_RLS_ROLE,
  parseSqlPolicySpec,
  rlsScopesJson,
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

  test("accepts Drizzle as/to/for aliases", () => {
    const spec = parseSqlPolicySpec({
      name: "gate_read",
      table: "bookings",
      for: "select",
      as: "permissive",
      to: "current_user",
      using: "oke.gate() = 'member'",
    });
    expect(spec.command).toBe("SELECT");
    expect(spec.behavior).toBe("PERMISSIVE");
    expect(spec.roles).toEqual(["current_user"]);
    expect(buildCreatePolicySql(spec)).toContain("TO current_user");
    expect(buildCreatePolicySql(spec)).not.toContain('"current_user"');
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

describe("formatPolicyRole", () => {
  test("leaves Drizzle special roles unquoted", () => {
    expect(formatPolicyRole("public")).toBe("public");
    expect(formatPolicyRole("current_user")).toBe("current_user");
    expect(formatPolicyRole("member")).toBe('"member"');
  });
});

describe("emitPgPolicySource", () => {
  test("emits drizzle pgPolicy with oke helpers", () => {
    const spec = parseSqlPolicySpec({
      name: "gate_member_select",
      table: "bookings",
      command: "SELECT",
      using: "oke.gate() = 'member'",
    });
    expect(emitPgPolicySource(spec)).toContain('pgPolicy("gate_member_select"');
    expect(emitPgPolicySource(spec)).toContain('for: "select"');
    expect(emitPgPolicySource(spec)).toContain("oke.gate() = 'member'");
  });
});

describe("rlsScopesJson", () => {
  test("sorts unique scopes", () => {
    expect(rlsScopesJson(["booking:create", "member", "member"])).toBe(
      '["booking:create","member"]',
    );
  });
});

describe("buildRlsIdentityPreludeSql", () => {
  test("emits one statement per exec — never a multi-command batch", () => {
    const stmts = buildRlsIdentityPreludeSql({
      gate: "member",
      userId: "alice",
      scopes: ["member"],
    });
    expect(stmts.map((s) => s.sql)).toEqual([
      `SET LOCAL ROLE ${OKE_RLS_ROLE}`,
      "SET LOCAL row_security = on",
      "SELECT set_config('oke.gate', ?, true), set_config('oke.user', ?, true), set_config('oke.scopes', ?, true)",
    ]);
    for (const stmt of stmts) {
      expect(stmt.sql.includes(";")).toBe(false);
    }
    expect(stmts[2]?.params).toEqual(["member", "alice", '["member"]']);
  });
});

describe("OKE_RLS_HELPER_STATEMENTS", () => {
  test("has_scope uses jsonb_exists so ? is not a placeholder", () => {
    const hasScope = OKE_RLS_HELPER_STATEMENTS.find((s) => s.includes("oke.has_scope"));
    expect(hasScope).toBeDefined();
    expect(hasScope).toContain("jsonb_exists(");
    expect(hasScope).not.toMatch(/jsonb\s+\?/);
  });

  test("pins search_path to public so schema oke is not the table home", () => {
    expect(OKE_RLS_HELPER_STATEMENTS).toContain("SET search_path TO public, oke");
    expect(
      OKE_RLS_HELPER_STATEMENTS.some((s) => s.includes("ALTER TABLE oke.%I SET SCHEMA public")),
    ).toBe(true);
  });
});
