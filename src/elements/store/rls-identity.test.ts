import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../manifest/types.ts";
import { firstPolicyOrPublic, resolveRlsIdentity, rlsIdentityFromAuth } from "./rls-identity.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "app",
  gates: {
    public: { kind: "policy" },
    member: { kind: "policy", description: "Signed-in" },
    "booking:create": { kind: "policy", scopes: ["booking:create"] },
    "rate:x": { kind: "rate", max: 1, per: "1m" },
  },
};

describe("resolveRlsIdentity", () => {
  test("operator omit and bypass skip the stamp", () => {
    expect(resolveRlsIdentity({})).toBeNull();
    expect(resolveRlsIdentity({ asGate: "member", bypass: true })).toBeNull();
  });

  test("public and policy-only leave userId empty", () => {
    expect(resolveRlsIdentity({ asGate: "public", manifest: MANIFEST })).toEqual({
      gate: "public",
      userId: "",
      scopes: [],
    });
    expect(resolveRlsIdentity({ asGate: "member", manifest: MANIFEST })).toEqual({
      gate: "member",
      userId: "",
      scopes: ["member"],
    });
    expect(resolveRlsIdentity({ asGate: "booking:create", manifest: MANIFEST })).toEqual({
      gate: "booking:create",
      userId: "",
      scopes: ["booking:create"],
    });
  });

  test("seeded user keeps real id and mapped gate", () => {
    expect(
      resolveRlsIdentity({
        asUserId: "u1",
        asGate: "member",
        identities: [{ id: "u1", scopes: ["member"], status: "active" }],
        manifest: MANIFEST,
      }),
    ).toEqual({ gate: "member", userId: "u1", scopes: ["member"] });
  });

  test("refuses rate gates", () => {
    expect(resolveRlsIdentity({ asGate: "rate:x", manifest: MANIFEST })).toBeNull();
  });
});

describe("rlsIdentityFromAuth", () => {
  test("uses the first policy/public and live userId", () => {
    expect(
      rlsIdentityFromAuth({
        userId: "u1",
        scopes: new Set(["member", "booking:create"]),
        gateNames: ["member", "booking:create"],
      }),
    ).toEqual({
      gate: "member",
      userId: "u1",
      scopes: ["member", "booking:create"],
    });
  });

  test("skips cron (no gates) and operator bypass", () => {
    expect(
      rlsIdentityFromAuth({
        userId: null,
        scopes: [],
        gateNames: [],
      }),
    ).toBeNull();
    expect(
      rlsIdentityFromAuth({
        userId: "op",
        scopes: [],
        gateNames: ["member"],
        operator: true,
      }),
    ).toBeNull();
  });
});

describe("firstPolicyOrPublic", () => {
  test("skips rate ids", () => {
    expect(firstPolicyOrPublic(["rate:x", "member"])).toBe("member");
    expect(firstPolicyOrPublic(["public"])).toBe("public");
  });
});

describe("rlsIdentityFromAuth — tenant GUC", () => {
  test("stamps tenantId only when the field is provided", () => {
    expect(
      rlsIdentityFromAuth({
        userId: "u1",
        scopes: new Set(["member"]),
        gateNames: ["member"],
        tenantId: "acme",
      }),
    ).toEqual({
      gate: "member",
      userId: "u1",
      scopes: ["member"],
      tenantId: "acme",
    });
    expect(
      rlsIdentityFromAuth({
        userId: "u1",
        scopes: new Set(["member"]),
        gateNames: ["member"],
      }),
    ).toEqual({
      gate: "member",
      userId: "u1",
      scopes: ["member"],
    });
  });
});
