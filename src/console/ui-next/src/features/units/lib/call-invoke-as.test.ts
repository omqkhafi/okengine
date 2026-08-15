import { describe, expect, test } from "bun:test";
import { callInvokeAsReady, callInvokeAsToolbarLabel } from "../call/call-identity-menu.tsx";
import type { FlowIdentity } from "@/client.ts";

const IDENTITIES: readonly FlowIdentity[] = [
  {
    id: "user_demo",
    email: "demo@example.com",
    name: "Demo User",
    status: "active",
    scopes: ["member"],
  },
];

describe("callInvokeAsReady", () => {
  test("Operator and Public are always ready", () => {
    expect(callInvokeAsReady({ asGate: null, asUserId: null })).toBe(true);
    expect(callInvokeAsReady({ asGate: "public", asUserId: null })).toBe(true);
  });

  test("As needs a user or a policy", () => {
    expect(callInvokeAsReady({ asGate: "member", asUserId: null })).toBe(true);
    expect(callInvokeAsReady({ asGate: "member", asUserId: "user_demo" })).toBe(true);
  });
});

describe("callInvokeAsToolbarLabel", () => {
  test("labels Operator, Public, user, and policy", () => {
    expect(callInvokeAsToolbarLabel({ asGate: null, asUserId: null }, IDENTITIES)).toBe("Operator");
    expect(callInvokeAsToolbarLabel({ asGate: "public", asUserId: null }, IDENTITIES)).toBe(
      "Public",
    );
    expect(callInvokeAsToolbarLabel({ asGate: "member", asUserId: "user_demo" }, IDENTITIES)).toBe(
      "Demo User",
    );
    expect(callInvokeAsToolbarLabel({ asGate: "member", asUserId: null }, IDENTITIES)).toBe(
      "As · member",
    );
  });
});
