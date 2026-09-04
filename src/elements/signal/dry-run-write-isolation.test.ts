/**
 * Dry-run write isolation (console §9.4 · prompt 18.3.2).
 *
 * A consumer that decrements stock, dry-run-replayed 480 times, must leave
 * the store byte-for-byte unchanged while still reporting an honest pass/fail
 * count. Live replay still applies writes once per message.
 */

import { describe, expect, test } from "bun:test";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { createFx, type FxStubStoreHandle } from "../../kernel/fx.ts";
import { signal } from "./declare.ts";
import { createSignalRuntime } from "./runtime.ts";

describe("signal dry-run replay — write isolation", () => {
  test("480 dry-run stock decrements leave store unchanged; live replay writes once", async () => {
    const stockRow = { qty: 1000 };
    const before = structuredClone(stockRow);

    const runtime = createSignalRuntime({ driver: memorySignalDriver });
    runtime.register(
      signal.once("order-placed", { retries: 0,
        deadLetter: true }),
    );
    const bus = await runtime.start();

    const unsubFail = await bus.subscribe("order-placed", "flaky", async () => {
      const err = new Error("seed");
      (err as Error & { code: string }).code = "SeedFail";
      throw err;
    });

    const COUNT = 480;
    for (let i = 0; i < COUNT; i++) {
      await bus.emit("order-placed", { id: `ord_${i}`, sku: "sku-1" });
    }
    await bus.drain();
    await unsubFail();
    expect((await bus.deadLetters("order-placed")).length).toBe(COUNT);

    // Shared stock row across invocations (same object identity as storeData).
    await bus.subscribe("order-placed", "inventory", async (msg) => {
      const fx = createFx({
        flow: "inventory.onOrder",
        effects: {
          reads: ["sql:inventory"],
          writes: ["sql:inventory"],
        },
        storeData: { "sql:inventory": { "sku-1": stockRow } },
      });
      const store = fx.store("sql:inventory") as FxStubStoreHandle;
      const row = (await store.get("sku-1")) as {
        qty: number;
      };
      if (row.qty <= 0) {
        const err = new Error("out of stock");
        (err as Error & { code: string }).code = "OutOfStock";
        throw err;
      }
      row.qty -= 1;
      await store.set("sku-1", row);
      void msg;
    });

    const dry = await bus.replay({
      signal: "order-placed",
      ratePerSec: 10_000,
      dryRun: true,
    });

    expect(dry.dryRun).toBe(true);
    expect(dry.refused).toBeUndefined();
    expect(dry.attempted).toBe(COUNT);
    expect(dry.succeeded).toBe(COUNT);
    expect(dry.failed).toBe(0);
    // Byte-for-byte unchanged after the dry-run batch.
    expect(stockRow).toEqual(before);
    expect(JSON.stringify(stockRow)).toBe(JSON.stringify(before));

    const live = await bus.replay({
      signal: "order-placed",
      ratePerSec: 10_000,
      dryRun: false,
    });
    expect(live.succeeded).toBe(COUNT);
    // Live replay applied writes once per message.
    expect(stockRow.qty).toBe(before.qty - COUNT);

    await runtime.close();
  });
});
