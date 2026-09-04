/**
 * One order domain — all three delivery modes together.
 *
 * Teaching scenario (mirrored on the Signal docs page):
 * - `once`        order-placed   → competing fulfillment workers (+ retry/DLQ)
 * - `broadcast`   order-changed  → cache invalidation AND notification (fan-out)
 * - `live`        order-status   → client-visible feed via bus.live() replay
 *
 * Exclusive claim / retries / DLQ / live replay physics are proven in
 * delivery-modes.test.ts; this file only asserts the coherent wiring.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { memorySignalDriver, type SignalBus } from "../../drivers/index.ts";
import type { LiveEvent } from "../../drivers/signal-types.ts";
import { signal } from "./declare.ts";

async function takeLivePayloads(iter: AsyncIterable<LiveEvent>, n: number): Promise<unknown[]> {
  const out: unknown[] = [];
  const it = iter[Symbol.asyncIterator]();
  try {
    while (out.length < n) {
      const step = await it.next();
      if (step.done) break;
      out.push(step.value.payload);
    }
  } finally {
    await it.return?.();
  }
  return out;
}

const openBuses: SignalBus[] = [];

afterEach(async () => {
  while (openBuses.length) {
    await openBuses.pop()!.close();
  }
});

describe("signal order lifecycle · once + broadcast + live", () => {
  test("one placed order: exclusive fulfill, fan-out side effects, live status replay", async () => {
    // once — queued job: exactly one competing consumer fulfills
    const orderPlaced = signal.once("order-placed", { retries: 2,
      deadLetter: true });
    // broadcast — same domain event fan-out: every subscriber gets a copy
    const orderChanged = signal.broadcast("order-changed");
    // live — client-visible status feed (bus.live; createClient has no subscribe yet)
    const orderStatus = signal.live("order-status", { optional: true });

    const bus = await memorySignalDriver.open({
      signals: new Map([
        [orderPlaced.name, orderPlaced],
        [orderChanged.name, orderChanged],
        [orderStatus.name, orderStatus],
      ]),
    });
    openBuses.push(bus);

    const fulfilled: string[] = [];
    const cacheHits: string[] = [];
    const notifyHits: string[] = [];

    await bus.subscribe("order-placed", "fulfillment-a", async (m) => {
      const { orderId } = m.payload as { orderId: string };
      fulfilled.push(`a:${orderId}`);
      await bus.emit("order-changed", { orderId, kind: "placed" });
      await bus.emit("order-status", { orderId, status: "fulfilling" });
      await bus.emit("order-status", { orderId, status: "shipped" });
    });
    await bus.subscribe("order-placed", "fulfillment-b", async (m) => {
      const { orderId } = m.payload as { orderId: string };
      fulfilled.push(`b:${orderId}`);
      await bus.emit("order-changed", { orderId, kind: "placed" });
      await bus.emit("order-status", { orderId, status: "fulfilling" });
      await bus.emit("order-status", { orderId, status: "shipped" });
    });

    await bus.subscribe("order-changed", "cache-invalidate", async (m) => {
      cacheHits.push((m.payload as { orderId: string }).orderId);
    });
    await bus.subscribe("order-changed", "notify-customer", async (m) => {
      notifyHits.push((m.payload as { orderId: string }).orderId);
    });

    await bus.emit("order-placed", { orderId: "ord_42", total: 49.5 });
    await bus.emit("order-status", { orderId: "ord_42", status: "placed" });
    await bus.drain();

    // once: exactly one competing worker claimed the job
    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0] === "a:ord_42" || fulfilled[0] === "b:ord_42").toBe(true);

    // broadcast: both independent subscribers received the fan-out
    expect(cacheHits).toEqual(["ord_42"]);
    expect(notifyHits).toEqual(["ord_42"]);

    // live: late subscriber replays the full retained status history
    const feed = (await takeLivePayloads(bus.live("order-status"), 3)) as Array<{
      orderId: string;
      status: string;
    }>;
    expect(feed).toEqual([
      { orderId: "ord_42", status: "placed" },
      { orderId: "ord_42", status: "fulfilling" },
      { orderId: "ord_42", status: "shipped" },
    ]);
  });

  test("once retries then DLQ still apply inside the same domain", async () => {
    // Light reuse of once retry/DLQ — full matrix lives in delivery-modes.test.ts.
    const orderPlaced = signal.once("order-placed", { retries: 1,
      deadLetter: true });
    const bus = await memorySignalDriver.open({
      signals: new Map([[orderPlaced.name, orderPlaced]]),
    });
    openBuses.push(bus);

    let attempts = 0;
    await bus.subscribe("order-placed", "fulfillment", async () => {
      attempts += 1;
      throw new Error(`payment-gateway-${attempts}`);
    });

    await bus.emit("order-placed", { orderId: "ord_fail" });
    await bus.drain();

    expect(attempts).toBe(2); // retries + 1
    const dlq = await bus.deadLetters("order-placed");
    expect(dlq).toHaveLength(1);
    expect(dlq[0]!.payload).toEqual({ orderId: "ord_fail" });
    expect(dlq[0]!.failures.map((f) => f.attempt)).toEqual([1, 2]);
  });
});
