/**
 * `createTestApp` surface assumed by four-applications test blocks.
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { channel } from "../elements/channel.ts";
import { clock } from "../elements/clock.ts";
import { gate } from "../elements/gate.ts";
import { signal } from "../elements/signal.ts";
import { vault, VaultBootError } from "../elements/vault.ts";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { every, http } from "../kernel/triggers.ts";
import { createTestApp } from "./create-test-app.ts";

describe("createTestApp — four-applications surface", () => {
  test("auth.loginAs · api · signals.drain · clock.advance · cron.run · channels.sent · effects.of", async () => {
    resetBindings();
    resetFlowSeq();

    const member = gate.policy("member", ({ auth }) => !!auth.verified);
    const orderPlaced = signal("order-placed", {
      delivery: "once",
      retries: 2,
      deadLetter: true,
    });
    const mail = channel.email({ from: "test@oke.dev" });
    const orderConfirmed = mail.template("order-confirmed", {
      schema: z.object({
        name: z.string(),
        orderId: z.string(),
        total: z.number(),
      }),
    });

    on(
      http.post("/orders").gate(member),
      flow("orders.create", {
        in: z.object({ sku: z.string(), qty: z.number() }),
        out: z.object({ id: z.string() }),
        effects: { emits: ["order-placed"] },
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
        effects: { sends: ["order-confirmed"] },
        do: async ({ orderId }, fx) => {
          await fx.send(orderConfirmed, {
            to: fx.auth.userId ?? "anon",
            data: { name: "Ali", orderId, total: 10 },
          });
        },
      }),
    );

    on(
      every("1h"),
      flow("orders.expire", {
        do: (_i, fx) => {
          fx.log.info("expire");
        },
      }),
    );

    const app = oke({
      name: "harness",
      gate: { policies: [member] },
      signals: [orderPlaced],
      clocks: [clock("expire-stale", { every: "1h" })],
      channel: { templates: [orderConfirmed] },
      env: "test",
    });

    const t = await createTestApp(app, {
      gates: [member],
      signals: [orderPlaced],
      boot: {
        clocks: [clock("expire-stale", { every: "1h" })],
        channel: { templates: [orderConfirmed] },
      },
    });

    const u = await t.auth.loginAs({ scopes: ["order:create"] });
    expect(u.verified).toBe(true);

    const { data, error } = await t.api.orders!.create!({ sku: "COFFEE", qty: 2 }, { as: u });
    expect(error).toBeNull();
    expect(data).toMatchObject({ id: expect.any(String) });

    await t.signals.drain();
    const sent = t.channels.sent();
    expect(sent.length).toBeGreaterThanOrEqual(1);
    expect(sent.some((s) => "template" in s && s.template === "order-confirmed")).toBe(true);

    await t.clock.advance("2m");
    expect(await t.cron.run("expire-stale")).toBe(true);

    const events = await t.runs();
    expect(events.some((e) => e.flow === "orders.create")).toBe(true);
    const createRun = events.find((e) => e.flow === "orders.create")!;
    expect(t.effects.of(createRun.id).some((e) => e.kind === "emit")).toBe(true);

    await t.close();
  });

  test("ai.mock and ai.cost are assertable", async () => {
    resetBindings();
    resetFlowSeq();
    const app = oke({ name: "ai-harness", env: "test" });
    const t = await createTestApp(app);
    t.ai.mock("ticket-triage", { urgency: "high", team: "ops" });
    expect(t.ai.cost()).toBeLessThan(0.02);
    await t.close();
  });
});

describe("createTestApp — vault gaps still fail boot", () => {
  test("missing secrets listed together", async () => {
    resetBindings();
    resetFlowSeq();
    const app = oke({ name: "vault-fail", env: "prod" });

    try {
      await createTestApp(app, {
        secrets: [vault("A", { description: "alpha" }), vault("B", { description: "beta" })],
        boot: {
          env: "prod",
          vault: { allowDevFallbacks: false, chain: [] },
        },
      });
      expect.unreachable("should fail");
    } catch (err) {
      expect(err).toBeInstanceOf(VaultBootError);
      const gaps = (err as VaultBootError).gaps.map((g) => g.name).sort();
      expect(gaps).toEqual(["A", "B"]);
    }
  });
});
