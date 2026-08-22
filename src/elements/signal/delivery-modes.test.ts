/**
 * Signal delivery-mode adversarial proofs:
 * - once: one message → exactly one of two competing consumers
 * - once: retries then DLQ (and deadLetter: false)
 * - broadcast: every subscriber gets a copy
 * - live: late subscriber replays full retained history (unbounded)
 */

import { afterEach, describe, expect, test } from "bun:test";

import {
  createPostgresSignalFake,
  createSignalNatsFake,
  createSignalRedisFake,
  memorySignalDriver,
  natsSignalDriver,
  postgresSignalDriver,
  redisSignalDriver,
  type SignalBus,
  type SignalDriver,
} from "../../drivers/index.ts";
import { signal, type SignalDecl } from "./declare.ts";
import type { LiveEvent } from "../../drivers/signal-types.ts";

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

const drivers: Array<{
  label: string;
  driver: SignalDriver;
  setup?: () => Record<string, unknown>;
}> = [
  { label: "memory", driver: memorySignalDriver },
  {
    label: "postgres",
    driver: postgresSignalDriver,
    setup: () => ({ sql: createPostgresSignalFake() }),
  },
  {
    label: "redis",
    driver: redisSignalDriver,
    setup: () => ({ redis: createSignalRedisFake() }),
  },
  {
    label: "nats",
    driver: natsSignalDriver,
    setup: () => ({ nats: createSignalNatsFake() }),
  },
];

const openBuses: SignalBus[] = [];

afterEach(async () => {
  while (openBuses.length) {
    await openBuses.pop()!.close();
  }
});

async function openBus(
  driver: SignalDriver,
  decls: readonly SignalDecl[],
  extra: Record<string, unknown> = {},
): Promise<SignalBus> {
  const signals = new Map(decls.map((d) => [d.name, d]));
  const bus = await driver.open({
    signals,
    ...extra,
  });
  openBuses.push(bus);
  return bus;
}

for (const { label, driver, setup } of drivers) {
  describe(`signal delivery modes · ${label}`, () => {
    test("once: one message reaches exactly one of two competing consumers", async () => {
      // Shape matches Linkly linkClicked / Provisions order-placed.
      const once = signal("link-clicked", {
        delivery: "once",
        retries: 3,
        deadLetter: true,
      });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      const got: string[] = [];

      await bus.subscribe("link-clicked", "worker-a", async (m) => {
        got.push(`a:${(m.payload as { code: string }).code}`);
      });
      await bus.subscribe("link-clicked", "worker-b", async (m) => {
        got.push(`b:${(m.payload as { code: string }).code}`);
      });

      await bus.emit("link-clicked", { code: "abc" });
      await bus.drain();

      expect(got).toHaveLength(1);
      expect(got[0] === "a:abc" || got[0] === "b:abc").toBe(true);
    });

    test("once: retries+1 attempts then dead-letter when deadLetter: true", async () => {
      const once = signal("flaky", {
        delivery: "once",
        retries: 2,
        deadLetter: true,
      });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      let attempts = 0;
      await bus.subscribe("flaky", "c1", async () => {
        attempts += 1;
        throw new Error(`boom-${attempts}`);
      });

      await bus.emit("flaky", { x: 1 });
      await bus.drain();

      // attempts > retries ⇒ retries + 1 total handler invocations.
      expect(attempts).toBe(3);
      const dlq = await bus.deadLetters("flaky");
      expect(dlq).toHaveLength(1);
      expect(dlq[0]!.failures.map((f) => f.attempt)).toEqual([1, 2, 3]);
    });

    test("once: deadLetter: false marks delivered after exhausting retries", async () => {
      const once = signal("flaky-drop", {
        delivery: "once",
        retries: 1,
        deadLetter: false,
      });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      let attempts = 0;
      await bus.subscribe("flaky-drop", "c1", async () => {
        attempts += 1;
        throw new Error("nope");
      });

      await bus.emit("flaky-drop", { x: 1 });
      await bus.drain();

      expect(attempts).toBe(2);
      expect(await bus.deadLetters("flaky-drop")).toHaveLength(0);
      const stats = await bus.inspect("flaky-drop");
      expect(stats[0]?.dead).toBe(0);
      expect(stats[0]?.delivered).toBe(1);
    });

    test("broadcast: every subscriber receives its own copy", async () => {
      const bcast = signal("news", { delivery: "broadcast" });
      const bus = await openBus(driver, [bcast], setup?.() ?? {});
      const a: unknown[] = [];
      const b: unknown[] = [];
      await bus.subscribe("news", "sub-a", async (m) => {
        a.push(m.payload);
      });
      await bus.subscribe("news", "sub-b", async (m) => {
        b.push(m.payload);
      });

      await bus.emit("news", { headline: "hi" });
      await bus.drain();

      expect(a).toEqual([{ headline: "hi" }]);
      expect(b).toEqual([{ headline: "hi" }]);
    });

    test("live: late subscriber replays full retained history (unbounded)", async () => {
      // Shape matches Skyport seat-feed.
      const live = signal("seat-feed", { delivery: "live", optional: true });
      const bus = await openBus(driver, [live], setup?.() ?? {});

      await bus.emit("seat-feed", { seat: "12A" });
      await bus.emit("seat-feed", { seat: "12B" });
      await bus.emit("seat-feed", { seat: "12C" });
      await bus.drain();

      const late = await takeLivePayloads(bus.live("seat-feed"), 3);

      // All retained live messages replay — not the Console recentLive cap of 50.
      expect(late).toEqual([{ seat: "12A" }, { seat: "12B" }, { seat: "12C" }]);
    });
  });
}
