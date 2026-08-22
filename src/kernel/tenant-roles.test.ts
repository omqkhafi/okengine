/**
 * Tenant-role scope union is conditional — never JWT-melt, never on
 * `tenantScoped: false` flows.
 */

import { describe, expect, test } from "bun:test";
import { createTenant, createTenantStore, upsertTenantRole } from "../auth/tenants.ts";
import { gate } from "../elements/gate.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { isFlowFailure } from "./hooks.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

const SECRET = "tenant-roles-test-secret";

describe("tenant-role scope union", () => {
  test("tenant-granted scope does not authorize a tenantScoped: false route", async () => {
    resetBindings();
    resetFlowSeq();
    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const booking = gate.scope("booking:create");
    const tenantStore = createTenantStore();
    await createTenant(tenantStore, { name: "Acme", createdBy: "u1", id: "t1" });
    upsertTenantRole(tenantStore, {
      tenantId: "t1",
      roleName: "member",
      scopes: ["booking:create"],
      catalog: ["booking:create", "member"],
    });

    on(
      http.get("/global").gate(booking),
      flow("global.ping", {
        tenantScoped: false,
        do: () => "global",
      }),
    );
    on(
      http.get("/tenant").gate(booking),
      flow("tenant.ping", {
        do: () => "tenant",
      }),
    );

    const app = oke({
      name: "tenant-roles",
      env: "test",
      startScheduler: false,
      gate: {
        policies: [member, booking],
        auth: { secret: SECRET, tenant: true, tenantStore, http: false },
      },
    });
    await app.boot({ env: "test", startScheduler: false });

    const principal = {
      plane: "user" as const,
      userId: "u1",
      scopes: [] as string[],
      verified: true,
      tenantId: "t1",
    };

    const leak = await app.execute(
      app.flow("global.ping")!,
      undefined,
      http.get("/global").gate(booking),
      { principal },
    );
    expect(leak.failure && isFlowFailure(leak.failure)).toBe(true);
    if (leak.failure && isFlowFailure(leak.failure)) {
      expect(leak.failure.error.code).toBe("Forbidden");
    }

    const allowed = await app.execute(
      app.flow("tenant.ping")!,
      undefined,
      http.get("/tenant").gate(booking),
      { principal },
    );
    expect(allowed.failure).toBeUndefined();
    expect(allowed.output).toBe("tenant");

    await app.bootResult?.close();
  });
});
