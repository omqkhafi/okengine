/**
 * Type accumulation through `.plug()` — decorations visible downstream.
 */

import { beforeEach, describe, expect, test } from "bun:test";
import { oke, type OkeApp } from "../app.ts";
import { flow, resetFlowSeq } from "../flow.ts";
import { on, resetBindings } from "../on.ts";
import { plugin, type PluginDef } from "../plugin.ts";
import { http } from "../triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

/** Compile-time assert: `Actual` extends `Expected`. */
type ExpectExtends<Actual, Expected> = Actual extends Expected ? true : false;

describe("plugin decorate — types and runtime", () => {
  test("decoration is visible in downstream handlers", async () => {
    const audit = plugin("audit", { version: "1.0.0" }).decorate("audit", {
      enabled: true,
      retain: "2y",
    });

    let seen: unknown;
    on(
      http.get("/x"),
      flow("x", {
        do: (_input, _fx) => {
          return { ok: true };
        },
      }).hook("beforeHandle", (ctx) => {
        seen = ctx.decorations.audit;
      }),
    );

    const app = oke({ autoBoot: false, name: "decorate" }).plug(audit);
    await app.fetch(new Request("http://localhost/x"));

    expect(seen).toEqual({ enabled: true, retain: "2y" });
  });

  test("types accumulate through .plug()", () => {
    const withAudit = plugin("audit", { version: "1.0.0" }).decorate("audit", {
      enabled: true as const,
    });
    const withBilling = plugin("billing", { version: "1.0.0" }).decorate("billing", {
      currency: "SAR" as const,
    });

    const app = oke({ autoBoot: false, name: "types" }).plug(withAudit).plug(withBilling);

    type AppDeco = typeof app extends OkeApp<infer D> ? D : never;
    type HasBoth = ExpectExtends<
      AppDeco,
      { audit: { enabled: true }; billing: { currency: "SAR" } }
    >;

    const _typeCheck: HasBoth = true;
    expect(_typeCheck).toBe(true);

    // PluginDef decoration param also accumulates on the builder itself.
    type AuditPlugin = typeof withAudit;
    type AuditDeco = AuditPlugin extends PluginDef<infer D> ? D : never;
    type HasAudit = ExpectExtends<AuditDeco, { audit: { enabled: true } }>;
    const _pluginType: HasAudit = true;
    expect(_pluginType).toBe(true);
  });

  test("unit-scoped decoration does not leak to another unit", async () => {
    const seen: Record<string, unknown> = {};

    on(
      http.get("/orders"),
      flow("orders.list", {
        do: () => ({}),
      }).hook("beforeHandle", (ctx) => {
        seen.orders = ctx.decorations.flag;
      }),
    );
    on(
      http.get("/payments"),
      flow("payments.list", {
        do: () => ({}),
      }).hook("beforeHandle", (ctx) => {
        seen.payments = ctx.decorations.flag;
      }),
    );

    const app = oke({ autoBoot: false, name: "deco-scope" });
    app.unit("orders").plug(plugin("flag", { version: "1.0.0" }).decorate("flag", "orders-only"));

    await app.fetch(new Request("http://localhost/orders"));
    await app.fetch(new Request("http://localhost/payments"));

    expect(seen.orders).toBe("orders-only");
    expect(seen.payments).toBeUndefined();
  });
});
