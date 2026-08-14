import { describe, expect, test } from "bun:test";
import {
  filterRlsPolicyTemplates,
  parseSqlPolicySpec,
  RLS_POLICY_COMMANDS,
  RLS_POLICY_TEMPLATES,
  rlsCommandFromGateMode,
  rlsGateActionsForMode,
  rlsGateModeFromCommand,
  rlsPolicyPredicates,
  rlsPolicyPreviewSql,
  rlsStoreGateActions,
} from "./rls-policy.ts";

describe("rlsPolicyPreviewSql", () => {
  test("reviews ENABLE RLS then CREATE POLICY", () => {
    const spec = parseSqlPolicySpec({
      name: "read_all",
      table: "bookings",
      command: "SELECT",
      using: "true",
    });
    expect(rlsPolicyPreviewSql(spec, true)).toBe(
      [
        'ALTER TABLE "bookings" ENABLE ROW LEVEL SECURITY;',
        'CREATE POLICY "read_all"',
        '  ON "bookings"',
        "  AS PERMISSIVE",
        "  FOR SELECT",
        "  TO public",
        "  USING (true);",
      ].join("\n"),
    );
  });

  test("omits ENABLE RLS when unchecked", () => {
    const spec = parseSqlPolicySpec({
      name: "read_all",
      table: "bookings",
      using: "true",
    });
    expect(rlsPolicyPreviewSql(spec, false)).toBe(
      [
        'CREATE POLICY "read_all"',
        '  ON "bookings"',
        "  AS PERMISSIVE",
        "  FOR SELECT",
        "  TO public",
        "  USING (true);",
      ].join("\n"),
    );
  });
});

describe("RLS_POLICY_TEMPLATES", () => {
  test("covers every FOR command and is searchable", () => {
    const commands = new Set(RLS_POLICY_TEMPLATES.map((tpl) => tpl.command));
    for (const command of RLS_POLICY_COMMANDS) {
      expect(commands.has(command)).toBe(true);
    }
    expect(RLS_POLICY_TEMPLATES.some((tpl) => tpl.behavior === "RESTRICTIVE")).toBe(true);
    expect(filterRlsPolicyTemplates(RLS_POLICY_TEMPLATES, "oke.gate").length).toBeGreaterThan(0);
    expect(filterRlsPolicyTemplates(RLS_POLICY_TEMPLATES, "owner").length).toBeGreaterThan(0);
    expect(filterRlsPolicyTemplates(RLS_POLICY_TEMPLATES, "missing")).toEqual([]);
  });
});

describe("rlsPolicyPredicates", () => {
  test("shows only the clauses Postgres accepts", () => {
    expect(rlsPolicyPredicates("SELECT")).toEqual({ using: true, withCheck: false });
    expect(rlsPolicyPredicates("INSERT")).toEqual({ using: false, withCheck: true });
    expect(rlsPolicyPredicates("UPDATE")).toEqual({ using: true, withCheck: true });
    expect(rlsPolicyPredicates("DELETE")).toEqual({ using: true, withCheck: false });
    expect(rlsPolicyPredicates("ALL")).toEqual({ using: true, withCheck: true });
  });
});

describe("rls gate posture", () => {
  test("maps commands to Module:Action pairs", () => {
    expect(rlsStoreGateActions("SELECT")).toEqual(["store.sql:read"]);
    expect(rlsStoreGateActions("INSERT")).toEqual(["store.sql:write"]);
    expect(rlsStoreGateActions("ALL")).toEqual(["store.sql:read", "store.sql:write"]);
  });

  test("syncs Gate mode and SQL command", () => {
    expect(rlsGateModeFromCommand("SELECT")).toBe("read");
    expect(rlsGateModeFromCommand("UPDATE")).toBe("write");
    expect(rlsGateModeFromCommand("ALL")).toBe("both");
    expect(rlsCommandFromGateMode("read", "INSERT")).toBe("SELECT");
    expect(rlsCommandFromGateMode("write", "UPDATE")).toBe("UPDATE");
    expect(rlsCommandFromGateMode("write", "SELECT")).toBe("INSERT");
    expect(rlsCommandFromGateMode("both", "SELECT")).toBe("ALL");
    expect(rlsGateActionsForMode("both")).toEqual(["store.sql:read", "store.sql:write"]);
  });
});
