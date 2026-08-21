/**
 * Default invoke-as ladder — ten rungs, historic demo + member ids.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import { createRoleStore } from "../../auth/index.ts";
import {
  DEV_IDENTITY_LADDER,
  KEEL_SCOPES,
  defaultDevIdentities,
  defaultMemberIdentityIds,
  demoScopesFromManifest,
  isDefaultIdentitySeed,
  refreshSeededIdentities,
  scopesForDevIdentityRung,
  seedKeelAccessRoles,
} from "./dev-identities.ts";

const KEEL_LIKE: Manifest = {
  oke: "1.0",
  app: "keel-like",
  gates: {
    member: { kind: "policy", scopes: ["member"] },
    "task:write": { kind: "policy", scopes: ["task:write"] },
    "comment:write": { kind: "policy", scopes: ["comment:write"] },
    "files:write": { kind: "policy", scopes: ["files:write"] },
    "project:admin": { kind: "policy", scopes: ["project:admin"] },
    "member:admin": { kind: "policy", scopes: ["member:admin"] },
    "webhook:admin": { kind: "policy", scopes: ["webhook:admin"] },
  },
};

describe("DEV_IDENTITY_LADDER", () => {
  test("is ten people from owner to guest and keeps demo + member", () => {
    expect(DEV_IDENTITY_LADDER).toHaveLength(10);
    expect(DEV_IDENTITY_LADDER[0]).toMatchObject({
      id: "user_demo",
      email: "demo@example.com",
      role: "owner",
    });
    expect(DEV_IDENTITY_LADDER[7]).toMatchObject({
      id: "user_member",
      email: "member@example.com",
      role: "member",
    });
    expect(DEV_IDENTITY_LADDER[9]?.role).toBe("guest");
    expect(new Set(DEV_IDENTITY_LADDER.map((p) => p.role)).size).toBe(10);
  });
});

describe("defaultDevIdentities", () => {
  test("demo follows the Manifest; member stays member-only", () => {
    const rows = defaultDevIdentities({
      oke: "1.0",
      app: "keel-like",
      gates: {
        member: { kind: "policy", scopes: ["member"] },
        "task:write": { kind: "policy", scopes: ["task:write"] },
        "booking:create": { kind: "policy", scopes: ["booking:create"] },
      },
    });
    const demo = rows.find((row) => row.id === "user_demo");
    const member = rows.find((row) => row.id === "user_member");
    const guest = rows.find((row) => row.id === "user_guest");
    expect(demo?.scopes).toEqual(["booking:create", "member", "task:write"]);
    expect(member?.scopes).toEqual(["member"]);
    expect(guest?.scopes).toEqual([]);
    expect(demo?.scopes).not.toEqual(member?.scopes);
  });

  test("keel profiles step down from owner to guest", () => {
    const catalog = demoScopesFromManifest(KEEL_LIKE);
    const owner = scopesForDevIdentityRung(0, catalog);
    const admin = scopesForDevIdentityRung(1, catalog);
    const member = scopesForDevIdentityRung(7, catalog);
    const guest = scopesForDevIdentityRung(9, catalog);
    expect(owner).toEqual(catalog);
    expect(admin).toEqual(catalog);
    expect(scopesForDevIdentityRung(2, catalog).length).toBeLessThan(admin.length);
    expect(member).toEqual(["member"]);
    expect(guest).toEqual([]);
  });
});

describe("refreshSeededIdentities", () => {
  test("replaces the default ladder and ignores a custom list", () => {
    const seeded = defaultDevIdentities();
    refreshSeededIdentities(seeded, KEEL_LIKE);
    expect(seeded.find((row) => row.id === "user_demo")?.scopes).toContain("task:write");
    expect(isDefaultIdentitySeed(seeded)).toBe(true);

    const custom = [{ ...seeded[0]!, id: "user_custom" }];
    refreshSeededIdentities(custom, KEEL_LIKE);
    expect(custom).toHaveLength(1);
  });
});

describe("keel scope seed", () => {
  test("keel Manifest unions every declared Gate scope onto owner", () => {
    const rows = defaultDevIdentities({ oke: "1.0", app: "keel" });
    const demo = rows.find((row) => row.id === "user_demo");
    expect(demo?.scopes).toEqual([...KEEL_SCOPES].sort((a, b) => a.localeCompare(b)));
    expect(rows.find((row) => row.id === "user_admin")?.scopes).toEqual([...KEEL_SCOPES].sort());
    expect(rows.find((row) => row.id === "user_member")?.scopes).toEqual(["member"]);
    expect(rows.find((row) => row.id === "user_guest")?.scopes).toEqual([]);
  });

  test("seedKeelAccessRoles writes every Keel scope onto owner", () => {
    const roles = createRoleStore();
    const roleMembers = new Map<string, string[]>();
    seedKeelAccessRoles(roles, roleMembers);
    expect([...(roles.grants.get("role_owner") ?? [])].sort()).toEqual(
      [...KEEL_SCOPES].sort((a, b) => a.localeCompare(b)),
    );
    expect(KEEL_SCOPES.every((scope) => roles.grants.get("role_owner")?.has(scope))).toBe(true);
    expect(roleMembers.get("role_owner")).toEqual(["user_demo"]);
  });
});

describe("defaultMemberIdentityIds", () => {
  test("omits guest", () => {
    expect(defaultMemberIdentityIds()).not.toContain("user_guest");
    expect(defaultMemberIdentityIds()).toContain("user_demo");
    expect(defaultMemberIdentityIds()).toContain("user_member");
  });
});
