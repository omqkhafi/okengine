/**
 * Dry-run replay must never contact a real channel (console §9.4 · prompt 18.3.1).
 *
 * Reversible effects still execute; send/ask are stubbed via fx ALS — the same
 * reversibility contract Traces states for external effects.
 */

import { describe, expect, test } from "bun:test";
import { memorySignalDriver } from "../../drivers/signal-memory.ts";
import { createFx, type FxStubStoreHandle } from "../../kernel/fx.ts";
import type { ChannelRuntime } from "../channel/runtime.ts";
import { signal } from "./declare.ts";
import { createSignalRuntime } from "./runtime.ts";

describe("signal dry-run replay — external effects stubbed", () => {
  test("480 dry-run replays → zero real channel deliveries; live replay still fires", async () => {
    let realSends = 0;
    const channelRuntime = {
      async send() {
        realSends += 1;
        return { ok: true as const, receiptId: "r1" };
      },
    } as unknown as ChannelRuntime;

    const runtime = createSignalRuntime({ driver: memorySignalDriver });
    runtime.register(
      signal("order-placed", {
        delivery: "once",
        retries: 0,
        deadLetter: true,
      }),
    );
    const bus = await runtime.start();

    // Seed DLQ with a failing consumer, then replace with a send consumer.
    const unsubFail = await bus.subscribe("order-placed", "flaky", async () => {
      const err = new Error("seed");
      (err as Error & { code: string }).code = "SeedFail";
      throw err;
    });

    const COUNT = 480;
    for (let i = 0; i < COUNT; i++) {
      await bus.emit("order-placed", { id: `ord_${i}` });
    }
    await bus.drain();
    await unsubFail();
    expect((await bus.deadLetters("order-placed")).length).toBe(COUNT);

    await bus.subscribe("order-placed", "fulfillment", async (msg) => {
      const fx = createFx({
        flow: "fulfillment.onOrder",
        effects: {
          writes: ["sql:shipments"],
          sends: ["booking-confirmed"],
        },
        channelRuntime,
        storeData: { "sql:shipments": {} },
      });
      const id = String((msg.payload as { id?: string }).id ?? "x");
      const store = fx.store("sql:shipments") as FxStubStoreHandle;
      await store.set(id, { ok: true });
      await fx.send("booking-confirmed", { to: "ops@example.com" });
    });

    realSends = 0;
    const dry = await bus.replay({
      signal: "order-placed",
      ratePerSec: 10_000,
      dryRun: true,
    });

    expect(dry.dryRun).toBe(true);
    expect(dry.attempted).toBe(COUNT);
    expect(dry.succeeded).toBe(COUNT);
    expect(dry.failed).toBe(0);
    expect(realSends).toBe(0);
    expect(dry.wouldHaveFired.length).toBe(COUNT);
    expect(dry.wouldHaveFired.every((w) => w.kind === "send")).toBe(true);
    expect((await bus.deadLetters("order-placed")).length).toBe(COUNT);

    const live = await bus.replay({
      signal: "order-placed",
      ratePerSec: 10_000,
      dryRun: false,
    });
    expect(live.dryRun).toBe(false);
    expect(live.succeeded).toBe(COUNT);
    // Live replay invokes handlers for real (channel fires); stubs empty.
    expect(realSends).toBe(COUNT);
    expect(live.wouldHaveFired.length).toBe(0);

    await runtime.close();
  });
});
