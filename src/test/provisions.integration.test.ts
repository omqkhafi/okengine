/**
 * Provisions-shaped integration: gate → signal → durable step → channel.
 *
 * Mirrors four-applications §3 (orders.create → chargeOrder → notify).
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { channel } from "../elements/channel.ts";
import { gate } from "../elements/gate.ts";
import { signal } from "../elements/signal.ts";
import { vault } from "../elements/vault.ts";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { createTestApp } from "./create-test-app.ts";

describe("Provisions integration", () => {
  test("gate → signal → durable sleep → channel in one flow chain", async () => {
    resetBindings();
    resetFlowSeq();

    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const canOrder = gate.policy("order:create", ({ auth }) => auth.scopes.has("order:create"));
    const stripeKey = vault("STRIPE_KEY", {
      description: "Payments gateway key",
      dev: "sk_test_local",
    });

    const orderPlaced = signal.once("order-placed", { retries: 3,
      deadLetter: true });
    const orderNews = signal.once("order-news", { retries: 3,
      deadLetter: true });

    const mail = channel.email({ from: "Provisions <no-reply@provisions.sa>" });
    const orderConfirmed = mail.template("order-confirmed", {
      schema: z.object({
        name: z.string(),
        orderId: z.string(),
        total: z.number(),
      }),
    });

    const chargeOrder = flow("payments.chargeOrder", {
      durable: true,
      in: z.object({ orderId: z.string() }),
      out: z.boolean(),
      effects: { secrets: ["STRIPE_KEY"], emits: ["order-news"] },
      do: async ({ orderId }, fx) => {
        const key = await fx.vault.get(stripeKey);
        expect(key.reveal().startsWith("sk_")).toBe(true);

        await fx.step("create-intent", async () => ({ id: `pi_${orderId}` }));
        await fx.clock.sleep("verify-window", "2m");
        await fx.step("confirm", async () => true);

        await fx.emit(orderNews, { orderId, status: "confirmed" });
        return true;
      },
    });

    on(
      http.post("/orders").gate(member, canOrder),
      flow("orders.create", {
        in: z.object({ sku: z.string(), qty: z.number() }),
        out: z.object({ id: z.string() }),
        effects: { emits: ["order-placed"], calls: ["payments.chargeOrder"] },
        do: async (input, fx) => {
          const id = fx.id();
          await fx.emit(orderPlaced, { orderId: id, ...input });
          return { id };
        },
      }),
    );

    on(
      orderPlaced,
      flow("orders.onPlaced", {
        effects: { calls: ["payments.chargeOrder"] },
        do: async ({ orderId }, fx) => {
          await fx.call(chargeOrder, { orderId });
        },
      }),
    );

    on(
      orderNews,
      flow("notifications.onNews", {
        effects: { sends: ["order-confirmed"] },
        do: async ({ orderId, status }, fx) => {
          if (status !== "confirmed") return;
          await fx.send(orderConfirmed, {
            to: "user-1",
            data: { name: "Ali", orderId, total: 42 },
          });
        },
      }),
    );

    const app = oke({
      name: "provisions",
      gate: { policies: [member, canOrder] },
      secrets: [stripeKey],
      signals: [orderPlaced, orderNews],
      channel: { templates: [orderConfirmed] },
      env: "test",
    });
    app.adopt(chargeOrder);

    const t = await createTestApp(app, {
      gates: [member, canOrder],
      secrets: [stripeKey],
      signals: [orderPlaced, orderNews],
      boot: { channel: { templates: [orderConfirmed] } },
    });

    // Anonymous → Unauthorized
    const denied = await t.api.orders!.create!({ sku: "COFFEE", qty: 1 });
    expect(denied.error?.code).toBe("Unauthorized");

    const u = await t.auth.loginAs({ scopes: ["order:create"] });
    const { data, error } = await t.api.orders!.create!({ sku: "COFFEE", qty: 2 }, { as: u });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: expect.any(String) });

    // Signal consumer starts durable charge → parks on 2m sleep.
    await t.signals.drain();
    expect(t.channels.sent()).toHaveLength(0);

    // Durable sleep elapses; charge completes → orderNews → channel.
    await t.clock.advance("2m");
    await t.signals.drain();

    expect(t.channels.sent()).toContainEqual(
      expect.objectContaining({
        template: "order-confirmed",
        to: "user-1",
      }),
    );

    const events = await t.runs();
    // First orders.create is the anonymous deny (stops at member); the
    // authenticated success evaluates the full chain.
    const createRun = events.find(
      (e) => e.flow === "orders.create" && e.gates.includes("order:create") && e.error == null,
    );
    expect(createRun).toBeDefined();
    expect(createRun!.gates).toEqual(["member", "order:create"]);
    expect(createRun!.dimensions["gate:member"]).toBe("pass");
    expect(createRun!.dimensions["gate:order:create"]).toBe("pass");

    await t.close();
  });
});
