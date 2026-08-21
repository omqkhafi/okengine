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
  rlsPolicyCodeSource,
  rlsGatePredicateSql,
  rlsStoreGateActions,
  rlsBindOwnerExpr,
  rlsExprNeedsOwnerColumn,
  rlsExprUsesUserIdentity,
  rlsOwnerColumn,
  rlsRewriteIdentityColumn,
  rlsTableColumns,
  rlsTableSqlColumns,
  rlsTemplateUsesOwner,
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
    expect(
      RLS_POLICY_TEMPLATES.some((tpl) => /\bcurrent_user\b/.test(`${tpl.using} ${tpl.withCheck}`)),
    ).toBe(false);
    expect(
      RLS_POLICY_TEMPLATES.some((tpl) => /oke\.user\(\)/.test(`${tpl.using} ${tpl.withCheck}`)),
    ).toBe(true);
  });
});

describe("rlsGatePredicateSql", () => {
  test("fills oke.gate / oke.has_scope — not Postgres TO", () => {
    expect(rlsGatePredicateSql([])).toBe("true");
    expect(rlsGatePredicateSql(["member"])).toBe("oke.gate() = 'member'");
    expect(rlsGatePredicateSql(["booking:create"])).toBe("oke.has_scope('booking:create')");
  });
});

describe("rlsPolicyCodeSource", () => {
  test("emits store.schema.policy and pgPolicy", () => {
    const spec = parseSqlPolicySpec({
      name: "gate_member_select",
      table: "bookings",
      command: "SELECT",
      using: "oke.gate() = 'member'",
    });
    const code = rlsPolicyCodeSource(spec);
    expect(code).toContain("store.schema.policy");
    expect(code).toContain("pgPolicy");
    expect(code).toContain("oke.gate()");
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

describe("rls owner column bind", () => {
  test("picks creator_email when owner is missing", () => {
    expect(rlsOwnerColumn(["id", "title", "creator_email"])).toBe("creator_email");
    expect(rlsOwnerColumn(["id", "owner_email"])).toBe("owner_email");
    expect(rlsOwnerColumn(["id", "title"])).toBeNull();
    expect(rlsBindOwnerExpr("owner = oke.user()", "creator_email")).toBe(
      "creator_email = oke.user()",
    );
    expect(rlsExprNeedsOwnerColumn("owner = oke.user()")).toBe(true);
    expect(rlsExprNeedsOwnerColumn("creator_email = oke.user()")).toBe(false);
  });

  test("reads Manifest sqlName / snake_case keys", () => {
    const cols = rlsTableSqlColumns(
      {
        oke: "1.0",
        app: "keel",
        stores: {
          db: {
            facet: "sql",
            tables: {
              tasks: {
                columns: {
                  creatorEmail: { type: "text", sqlName: "creator_email" },
                  title: { type: "text" },
                },
              },
            },
          },
        },
      },
      "sql:db",
      "tasks",
    );
    expect(cols).toEqual(["creator_email", "title"]);
    expect(rlsOwnerColumn(cols)).toBe("creator_email");
  });

  test("marks PK / declared FK / inferred *_id", () => {
    const cols = rlsTableColumns(
      {
        oke: "1.0",
        app: "keel",
        stores: {
          db: {
            facet: "sql",
            tables: {
              tasks: {
                columns: {
                  id: { type: "text", primaryKey: true, sqlName: "id" },
                  identifier: { type: "text", unique: true, sqlName: "identifier" },
                  spaceId: {
                    type: "text",
                    sqlName: "space_id",
                    references: { table: "spaces", column: "id" },
                  },
                  parentId: { type: "text", sqlName: "parent_id" },
                  title: { type: "text", sqlName: "title" },
                },
              },
            },
          },
        },
      },
      "sql:db",
      "tasks",
    );
    expect(cols.find((c) => c.sqlName === "id")).toMatchObject({
      primaryKey: true,
      foreignKey: false,
    });
    expect(cols.find((c) => c.sqlName === "identifier")).toMatchObject({ unique: true });
    expect(cols.find((c) => c.sqlName === "space_id")).toMatchObject({
      foreignKey: true,
      inferred: false,
    });
    expect(cols.find((c) => c.sqlName === "parent_id")).toMatchObject({
      foreignKey: true,
      inferred: true,
    });
    expect(cols.find((c) => c.sqlName === "title")).toMatchObject({
      foreignKey: false,
      primaryKey: false,
    });
  });

  test("rewrites owner or a previous identity column", () => {
    expect(rlsRewriteIdentityColumn("owner = oke.user()", "owner", "creator_email")).toBe(
      "creator_email = oke.user()",
    );
    expect(
      rlsRewriteIdentityColumn("creator_email = oke.user()", "creator_email", "owner_email"),
    ).toBe("owner_email = oke.user()");
    expect(rlsExprUsesUserIdentity("creator_email = oke.user()")).toBe(true);
    expect(rlsExprUsesUserIdentity("true")).toBe(false);
    expect(rlsTemplateUsesOwner({ using: "owner = oke.user()" })).toBe(true);
    expect(rlsTemplateUsesOwner({ withCheck: "true" })).toBe(false);
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
