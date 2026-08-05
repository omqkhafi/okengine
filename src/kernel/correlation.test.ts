/**
 * Trace parentId continuity: HTTP/producer → fx.emit → Signal → consumer Runs.
 */

import { describe, expect, test } from "bun:test";
import { signal } from "../elements/signal/declare.ts";
import { createRunsRuntime } from "../runs/runtime.ts";
import { flow } from "./flow.ts";
import { oke } from "./app.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

describe("correlation — parentId across Flow → Signal → Flow", () => {
  test("consumer WideEvent.parentId equals producer run id", async () => {
    resetBindings();
    const orderPlaced = signal("corr-order-placed", { delivery: "once" });
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();

    const producer = flow({
      name: "orders.create",
      effects: { emits: ["corr-order-placed"] },
      do: async (input: { id: string }, fx) => {
        await fx.emit(orderPlaced, { id: input.id });
        return { ok: true as const };
      },
    });

    const consumer = flow({
      name: "orders.notify",
      do: async (_input: { id: string }) => ({ notified: true as const }),
    });

    on(http.post("/orders"), producer);
    on(orderPlaced, consumer);

    const app = oke({
      name: "corr-signal",
      runs,
      signals: [orderPlaced],
      gate: { unguardedHttp: "allow" },
      startScheduler: false,
    });

    await app.boot({ env: "test", unguardedHttp: "allow" });
    const res = await app.fetch(
      new Request("http://localhost/orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "ord_1" }),
      }),
    );
    expect(res.ok).toBe(true);

    const bus = app.bootResult?.signal?.bus;
    expect(bus).toBeDefined();
    await bus!.drain();
    await runs.flush();

    const events = await runs.all();
    const create = events.find((e) => e.flow === "orders.create");
    const notify = events.find((e) => e.flow === "orders.notify");
    expect(create).toBeDefined();
    expect(notify).toBeDefined();
    expect(notify!.parentId).toBe(create!.id);

    await runs.close();
  });

  test("fx.call child records parentId", async () => {
    resetBindings();
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();

    const child = flow({
      name: "inner.work",
      do: () => ({ done: true as const }),
    });

    const parent = flow({
      name: "outer.work",
      effects: { calls: ["inner.work"] },
      do: async (_input, fx) => {
        await fx.call(child, {});
        return { ok: true as const };
      },
    });

    const app = oke({
      name: "corr-call",
      autoBoot: false,
      runs,
      gate: { unguardedHttp: "allow" },
    }).adopt(child, parent);
    await app.boot({ env: "test", unguardedHttp: "allow" });
    await app.execute(parent, {}, { kind: "internal" });
    await runs.flush();

    const events = await runs.all();
    const outer = events.find((e) => e.flow === "outer.work");
    const inner = events.find((e) => e.flow === "inner.work");
    expect(outer).toBeDefined();
    expect(inner).toBeDefined();
    expect(inner!.parentId).toBe(outer!.id);

    await runs.close();
  });
});
