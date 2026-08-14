/**
 * Unit tests for query-console Gate choices.
 */

import { describe, expect, test } from "bun:test";
import {
  filterQueryGateAsChoices,
  policyGateForScopes,
  queryGateChoices,
  queryGateMode,
  queryGatePolicyChoices,
  queryGateToolbarLabel,
  queryGateUserChoices,
} from "./query-gate.ts";
import { rlsGateCatalog } from "./rls-gate-catalog.ts";
import type { Manifest } from "../../../../../../manifest/types.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "test",
  gates: {
    public: { kind: "policy", description: "Open read" },
    member: { kind: "policy", description: "Signed-in member", roles: ["member"] },
    "rate:api": { kind: "rate", max: 10, per: "1m" },
  },
};

describe("queryGateChoices", () => {
  test("lists Operator, public, then policy gates — skips rate", () => {
    const choices = queryGateChoices(rlsGateCatalog(MANIFEST));
    expect(choices.map((c) => c.id)).toEqual(["operator", "public", "member"]);
    expect(choices[0]?.kind).toBe("operator");
    expect(choices[1]?.detail).toBe("Open read");
    expect(choices[2]?.detail).toBe("Signed-in member");
  });

  test("still lists Operator and public without a Manifest", () => {
    const choices = queryGateChoices(rlsGateCatalog(null));
    expect(choices.map((c) => c.id)).toEqual(["operator", "public"]);
  });
});

describe("queryGateMode", () => {
  test("null and empty are Operator; public is its own card; else As", () => {
    expect(queryGateMode(null)).toBe("operator");
    expect(queryGateMode("")).toBe("operator");
    expect(queryGateMode("public")).toBe("public");
    expect(queryGateMode("member")).toBe("as");
  });
});

describe("queryGatePolicyChoices", () => {
  test("lists policy gates only", () => {
    const policies = queryGatePolicyChoices(rlsGateCatalog(MANIFEST));
    expect(policies.map((c) => c.id)).toEqual(["member"]);
  });
});

describe("queryGateUserChoices", () => {
  test("keeps active identities that map onto a policy Gate", () => {
    const catalog = rlsGateCatalog(MANIFEST);
    const users = queryGateUserChoices(
      [
        {
          id: "idn_aria",
          name: "Aria",
          email: "aria@keel.dev",
          status: "active",
          scopes: ["member"],
        },
        {
          id: "idn_off",
          name: "Off",
          email: "off@keel.dev",
          status: "disabled",
          scopes: ["member"],
        },
        {
          id: "idn_none",
          name: "None",
          email: "none@keel.dev",
          status: "active",
          scopes: ["unknown"],
        },
      ],
      catalog,
    );
    expect(users).toEqual([
      { id: "idn_aria", label: "Aria", detail: "aria@keel.dev", gate: "member" },
    ]);
  });
});

describe("policyGateForScopes", () => {
  test("matches a Gate name, then a declared role", () => {
    const catalog = rlsGateCatalog(MANIFEST);
    expect(policyGateForScopes(["member"], catalog)).toBe("member");
    expect(policyGateForScopes(["unknown"], catalog)).toBeNull();
    const viaRole = rlsGateCatalog({
      ...MANIFEST,
      gates: {
        ...MANIFEST.gates,
        staff: { kind: "policy", roles: ["role_staff"] },
      },
    });
    expect(policyGateForScopes(["role_staff"], viaRole)).toBe("staff");
  });
});

describe("filterQueryGateAsChoices", () => {
  test("matches id, label, detail, and extra fields", () => {
    const policies = queryGatePolicyChoices(rlsGateCatalog(MANIFEST));
    expect(filterQueryGateAsChoices(policies, "member").map((c) => c.id)).toEqual(["member"]);
    expect(filterQueryGateAsChoices(policies, "signed-in").map((c) => c.id)).toEqual(["member"]);
    expect(filterQueryGateAsChoices(policies, "missing")).toEqual([]);
    const users = [{ id: "idn_aria", label: "Aria", detail: "aria@keel.dev", gate: "member" }];
    expect(filterQueryGateAsChoices(users, "aria", (row) => [row.gate]).map((c) => c.id)).toEqual([
      "idn_aria",
    ]);
    expect(filterQueryGateAsChoices(users, "member", (row) => [row.gate]).map((c) => c.id)).toEqual(
      ["idn_aria"],
    );
  });
});

describe("queryGateToolbarLabel", () => {
  test("Operator is Gate; a pick suffixes the name", () => {
    expect(queryGateToolbarLabel(null)).toBe("Gate");
    expect(queryGateToolbarLabel("")).toBe("Gate");
    expect(queryGateToolbarLabel("member")).toBe("Gate · member");
  });
});
