import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import {
  filterRlsGateCatalog,
  mergeRlsGateCatalog,
  rlsCatalogPolicies,
  rlsCatalogScopes,
  rlsCommandFromActions,
  rlsGateCatalog,
  rlsGateSelectionExtraCount,
  rlsGateSelectionIsCustom,
  rlsGateSelectionSummary,
  rlsGateVariant,
  rlsSyncActionsForCommand,
} from "./rls-gate-catalog.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "demo",
  flows: {
    "bookings.create": {
      plane: "user",
      gates: ["member", "booking:create"],
    },
  },
  gates: {
    member: {
      kind: "policy",
      description: "Signed-in member",
      roles: ["role_member"],
    },
    "booking:create": {
      kind: "policy",
      scopes: ["booking:create"],
    },
    "rate:http": {
      kind: "rate",
      strategy: "sliding-window-counter",
      max: 60,
      per: "1m",
    },
  },
};

describe("rlsGateCatalog", () => {
  test("lists public, policy, and scope — skips rate", () => {
    const catalog = rlsGateCatalog(MANIFEST);
    expect(catalog.gates.map((gate) => gate.name)).toEqual(["public", "member", "booking:create"]);
    expect(catalog.gates.map((gate) => gate.variant)).toEqual(["public", "policy", "scope"]);
    expect(rlsCatalogPolicies(catalog).map((gate) => gate.name)).toEqual(["public", "member"]);
    expect(rlsCatalogScopes(catalog).map((gate) => gate.name)).toEqual(["booking:create"]);
  });

  test("skips rate gates and still works without a Manifest", () => {
    const catalog = rlsGateCatalog(null);
    expect(catalog.gates.map((gate) => gate.name)).toEqual(["public"]);
    expect(catalog.gates[0]?.variant).toBe("public");
  });
});

describe("rlsGateVariant", () => {
  test("public by kind or name; scope when scopes are set", () => {
    expect(rlsGateVariant({ name: "public", kind: "public", scopes: [] })).toBe("public");
    expect(rlsGateVariant({ name: "member", kind: "policy", scopes: [] })).toBe("policy");
    expect(rlsGateVariant({ name: "issue:write", kind: "policy", scopes: ["issue:write"] })).toBe(
      "scope",
    );
  });
});

describe("mergeRlsGateCatalog", () => {
  test("adds Access roles and extra Module:Action pairs without changing Gate variants", () => {
    const merged = mergeRlsGateCatalog(rlsGateCatalog(MANIFEST), {
      moduleActions: ["vault:read"],
      principals: [
        { kind: "role", name: "admin" },
        { kind: "user", name: "ada" },
      ],
    });
    expect(merged.roles).toEqual(["admin", "role_member"]);
    expect(merged.actions).toContain("vault:read");
    expect(rlsCatalogScopes(merged).map((gate) => gate.name)).toEqual(["booking:create"]);
  });
});

describe("filterRlsGateCatalog", () => {
  test("filters policy and scope by name", () => {
    const catalog = filterRlsGateCatalog(rlsGateCatalog(MANIFEST), "book");
    expect(catalog.gates.map((gate) => gate.name)).toEqual(["booking:create"]);
    expect(rlsCatalogScopes(catalog).map((gate) => gate.name)).toEqual(["booking:create"]);
    expect(rlsCatalogPolicies(catalog)).toEqual([]);
  });
});

describe("rls command sync", () => {
  test("maps selected store.sql pairs onto FOR", () => {
    expect(rlsCommandFromActions(["store.sql:read"], "INSERT")).toBe("SELECT");
    expect(rlsCommandFromActions(["store.sql:write"], "UPDATE")).toBe("UPDATE");
    expect(rlsCommandFromActions(["store.sql:write"], "SELECT")).toBe("INSERT");
    expect(rlsCommandFromActions(["store.sql:read", "store.sql:write"], "SELECT")).toBe("ALL");
    expect(rlsCommandFromActions(["bookings:create"], "SELECT")).toBe("SELECT");
  });

  test("keeps custom pairs when the command changes", () => {
    expect(rlsSyncActionsForCommand(["bookings:create", "store.sql:read"], "INSERT")).toEqual([
      "bookings:create",
      "store.sql:write",
    ]);
    expect(rlsSyncActionsForCommand(["member"], "ALL")).toEqual([
      "member",
      "store.sql:read",
      "store.sql:write",
    ]);
  });
});

describe("rlsGateSelection", () => {
  test("summarizes and counts selected Gates only", () => {
    const selection = {
      gates: ["member", "booking:create"],
      actions: ["store.sql:read", "bookings:create"],
      roles: ["role_member"],
    };
    expect(rlsGateSelectionSummary(selection)).toBe("booking:create · member");
    expect(rlsGateSelectionExtraCount(selection)).toBe(2);
    expect(rlsGateSelectionIsCustom(selection, "SELECT")).toBe(true);
    expect(
      rlsGateSelectionIsCustom({ gates: [], actions: ["store.sql:read"], roles: [] }, "SELECT"),
    ).toBe(false);
  });
});
