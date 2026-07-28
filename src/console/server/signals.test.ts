import { describe, expect, test } from "bun:test";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { signal } from "../../elements/signal/declare.ts";
import { createMemorySignalConfigStore } from "../../elements/signal/reconcile.ts";
import { createSignalRuntime } from "../../elements/signal/runtime.ts";
import type { Manifest } from "../../manifest/types.ts";
import { projectSignalsList } from "./signals.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "signals-console-test",
  flows: {
    "bookings.create": {
      trigger: { http: { method: "POST", path: "/bookings" } },
      effects: { emits: ["order-placed"] },
    },
    "fulfillment.onOrder": {
      trigger: { signal: "order-placed" },
      durable: true,
      effects: { writes: ["sql:shipments"] },
    },
  },
  signals: {
    "order-placed": { delivery: "once", retries: 3, deadLetter: true },
  },
};

describe("projectSignalsList", () => {
  test("reads bus stats and surfaces durable consumers from Manifest", async () => {
    const runtime = createSignalRuntime({ driver: memorySignalDriver });
    const decl = signal("order-placed", {
      delivery: "once",
      retries: 3,
      deadLetter: true,
    });
    runtime.register(decl);
    const bus = await runtime.start();
    await bus.subscribe("order-placed", "oke:fulfillment", async () => {
      const err = new Error("card declined");
      (err as Error & { code: string }).code = "PaymentDeclined";
      throw err;
    });
    await bus.emit("order-placed", { orderId: "o1" });
    await bus.drain();
    await bus.drain();
    await bus.drain();
    await bus.drain();

    const config = createMemorySignalConfigStore([
      {
        name: "legacy-shipped",
        delivery: "once",
        retries: 3,
        deadLetter: true,
        status: "orphaned",
      },
    ]);

    const rows = await projectSignalsList({
      manifest: MANIFEST,
      config,
      bus,
    });

    const order = rows.find((r) => r.name === "order-placed");
    expect(order).toBeDefined();
    expect(order!.dead).toBeGreaterThan(0);
    expect(order!.consumersDurable).toBe(true);
    expect(order!.consumers[0]?.flowId).toBe("fulfillment.onOrder");
    expect(order!.producers[0]?.flowId).toBe("bookings.create");

    const orphan = rows.find((r) => r.name === "legacy-shipped");
    expect(orphan?.orphaned).toBe(true);

    const dry = await bus.replay({
      signal: "order-placed",
      ratePerSec: 100,
      dryRun: true,
    });
    expect(dry.dryRun).toBe(true);
    expect(dry.attempted).toBeGreaterThan(0);
    expect(dry.wouldHaveFired).toEqual([]);

    await runtime.close();
  });
});
