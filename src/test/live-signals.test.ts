/**
 * `createTestApp` deterministic live-signal subscriptions
 * (`signals.subscribeLive` / `signals.waitForLive`).
 */

import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq } from "../kernel/flow.ts";
import { on, resetBindings } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { signal } from "../elements/signal.ts";
import { createTestApp } from "./create-test-app.ts";

describe("createTestApp live-signal subscriptions", () => {
  test("subscribeLive observes deterministic live emits; waitForLive resolves matching payloads", async () => {
    resetBindings();
    resetFlowSeq();

    const orderStatus = signal("order-status", {
      delivery: "live",
      retention: { maxCount: 10 },
    });

    on(
      http.post("/orders/status").public(),
      flow("orders.updateStatus", {
        in: z.object({ orderId: z.string(), status: z.string() }),
        effects: { emits: ["order-status"] },
        do: async (input, fx) => {
          await fx.emit(orderStatus, input);
          return { ok: true };
        },
      }),
    );

    const app = oke({
      name: "live-signals-app",
      signals: [orderStatus],
      env: "test",
    });

    const t = await createTestApp(app, {
      signals: [orderStatus],
    });

    const seen: Array<{ orderId: string; status: string }> = [];
    const unsubscribe = t.signals.subscribeLive(orderStatus, {
      onEvent: (event) => {
        seen.push(event as { orderId: string; status: string });
      },
    });

    // Emit 1 — deterministic after drain.
    const res1 = await t.api.orders!.updateStatus!({ orderId: "o1", status: "placed" });
    expect(res1.error).toBeNull();
    await t.signals.drain();
    expect(seen.map((e) => e.status)).toEqual(["placed"]);

    // Emit 2 — observer updates.
    await t.api.orders!.updateStatus!({ orderId: "o1", status: "shipped" });
    await t.signals.drain();
    expect(seen.map((e) => e.status)).toEqual(["placed", "shipped"]);

    // waitForLive resolves the first payload matching the predicate.
    const deliveredPromise = t.signals.waitForLive(
      orderStatus,
      (event) => (event as { status: string }).status === "delivered",
    );
    await t.api.orders!.updateStatus!({ orderId: "o1", status: "delivered" });
    await t.signals.drain();
    const delivered = await deliveredPromise;
    expect((delivered as { status: string }).status).toBe("delivered");

    // Unsubscribe then emit — the subscription must not observe it.
    unsubscribe();
    await t.api.orders!.updateStatus!({ orderId: "o2", status: "placed" });
    await t.signals.drain();
    expect(seen).toHaveLength(3);

    await t.close();
  });
});