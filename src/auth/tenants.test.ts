/**
 * Tenant registry — user-plane catalog on write; membership helpers.
 */

import { describe, expect, test } from "bun:test";
import { isApplicationScope } from "../elements/gate/permissions.ts";
import {
  createTenant,
  createTenantStore,
  tenantRoleScopeFailure,
  upsertTenantRole,
} from "./tenants.ts";

describe("tenantRoleScopeFailure", () => {
  const catalog = ["booking:create", "member", "console:store.sql:write", "console:*"];

  test("unknown names and console:* fail the same way", () => {
    const invented = tenantRoleScopeFailure(["this:was:never:declared"], catalog);
    const consoleWrite = tenantRoleScopeFailure(["console:store.sql:write"], catalog);
    const consoleStar = tenantRoleScopeFailure(["console:*"], catalog);
    expect(invented?.reason).toBe("unknown_scope");
    expect(consoleWrite?.reason).toBe("unknown_scope");
    expect(consoleStar?.reason).toBe("unknown_scope");
    expect(isApplicationScope("console:store.sql:write")).toBe(false);
    expect(isApplicationScope("console:*")).toBe(false);
  });

  test("application catalog names are grantable", () => {
    expect(tenantRoleScopeFailure(["booking:create", "member"], catalog)).toBeNull();
  });
});

describe("upsertTenantRole", () => {
  test("console-shaped upsert throws like an invented name", async () => {
    const store = createTenantStore();
    await createTenant(store, { name: "Acme", createdBy: "u1", id: "t1" });
    const catalog = ["booking:create", "console:store.sql:write", "console:*"];
    expect(() =>
      upsertTenantRole(store, {
        tenantId: "t1",
        roleName: "admin",
        scopes: ["console:store.sql:write"],
        catalog,
      }),
    ).toThrow(/unknown or operator-plane scope/);
    expect(() =>
      upsertTenantRole(store, {
        tenantId: "t1",
        roleName: "admin",
        scopes: ["console:*"],
        catalog,
      }),
    ).toThrow(/unknown or operator-plane scope/);
    expect(() =>
      upsertTenantRole(store, {
        tenantId: "t1",
        roleName: "admin",
        scopes: ["this:was:never:declared"],
        catalog,
      }),
    ).toThrow(/unknown or operator-plane scope/);
  });
});
