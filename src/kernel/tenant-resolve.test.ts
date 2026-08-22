/**
 * Three-tier tenant identity resolution.
 */

import { describe, expect, test } from "bun:test";
import { createTenant, createTenantStore } from "../auth/tenants.ts";
import { resolveTenantAuth } from "../auth/tenant-config.ts";
import { isFlowFailure } from "./hooks.ts";
import { resolveRequestTenant } from "./tenant-resolve.ts";

describe("resolveRequestTenant", () => {
  test("claim trusts tid without a membership query", async () => {
    const store = createTenantStore();
    const result = resolveRequestTenant({
      config: resolveTenantAuth(true),
      auth: { userId: "u1", scopes: new Set() },
      claimTenantId: "not-a-member",
      store,
    });
    expect(result.id).toBe("not-a-member");
    expect(result.failure).toBeUndefined();
  });

  test("header never trusts a non-member", async () => {
    const store = createTenantStore();
    await createTenant(store, { name: "Acme", createdBy: "owner", id: "acme" });
    const result = resolveRequestTenant({
      config: resolveTenantAuth({ source: "header" }),
      auth: { userId: "u1", scopes: new Set() },
      claimTenantId: null,
      request: new Request("https://app.example/x", { headers: { "x-oke-tenant": "acme" } }),
      store,
    });
    expect(result.id).toBeNull();
    expect(result.failure && isFlowFailure(result.failure)).toBe(true);
    if (result.failure && isFlowFailure(result.failure)) {
      expect(result.failure.error.code).toBe("Forbidden");
      expect(result.failure.error.data).toEqual({
        gate: "auth:tenants",
        reason: "not_member",
      });
    }
  });

  test("header accepts a real membership", async () => {
    const store = createTenantStore();
    await createTenant(store, { name: "Acme", createdBy: "u1", id: "acme" });
    const result = resolveRequestTenant({
      config: resolveTenantAuth({ source: "header" }),
      auth: { userId: "u1", scopes: new Set() },
      claimTenantId: null,
      request: new Request("https://app.example/x", { headers: { "x-oke-tenant": "acme" } }),
      store,
    });
    expect(result.id).toBe("acme");
  });

  test("required + authenticated + no tenant is Forbidden tenant_required", () => {
    const store = createTenantStore();
    const result = resolveRequestTenant({
      config: resolveTenantAuth({ required: true }),
      auth: { userId: "u1", scopes: new Set() },
      claimTenantId: null,
      store,
    });
    expect(result.failure && isFlowFailure(result.failure)).toBe(true);
    if (result.failure && isFlowFailure(result.failure)) {
      expect(result.failure.error.data).toEqual({
        gate: "auth:tenants",
        reason: "tenant_required",
      });
    }
  });

  test("resolve callback still checks membership unless authoritative", async () => {
    const store = createTenantStore();
    const denied = resolveRequestTenant({
      config: resolveTenantAuth({
        source: "resolve",
        resolve: () => "ghost",
      }),
      auth: { userId: "u1", scopes: new Set() },
      claimTenantId: null,
      store,
    });
    expect(denied.failure && isFlowFailure(denied.failure)).toBe(true);

    await createTenant(store, { name: "Acme", createdBy: "u1", id: "acme" });
    const trusted = resolveRequestTenant({
      config: resolveTenantAuth({
        source: "resolve",
        authoritative: true,
        resolve: () => "ghost",
      }),
      auth: { userId: "u1", scopes: new Set() },
      claimTenantId: null,
      store,
    });
    expect(trusted.id).toBe("ghost");
  });
});
