/**
 * Per-key serialization for `once` — same (signal, key) never claimed
 * concurrently; emission order preserved; lease reclaim is the unlock.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPostgresSignalFake,
  memorySignalDriver,
  postgresSignalDriver,
  type SignalBus,
} from "../../drivers/index.ts";
import { signal } from "./declare.ts";
import { createSignalRuntime } from "./runtime.ts";

const openBuses: SignalBus[] = [];
const closers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (openBuses.length) {
    await openBuses.pop()!.close();
  }
  while (closers.length) {
    await closers.pop()!.close();
  }
});

describe("signal key ordering · memory", () => {
  test("same key: never concurrent; complete in emission order", async () => {
    const once = signal("order-events", {
      delivery: "once",
      retries: 3,
      deadLetter: true,
    });
    const bus = await memorySignalDriver.open({
      signals: new Map([[once.name, once]]),
    });
    openBuses.push(bus);

    let inflight = 0;
    let maxInflight = 0;
    const completed: number[] = [];
    const started = Promise.withResolvers<void>();
    let startedCount = 0;

    const handler = async (m: { payload: unknown }) => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      startedCount += 1;
      if (startedCount === 1) started.resolve();
      // Hold long enough for a concurrent drain to attempt the sibling.
      await Bun.sleep(40);
      completed.push((m.payload as { seq: number }).seq);
      inflight -= 1;
    };

    await bus.subscribe("order-events", "worker-a", handler);
    await bus.subscribe("order-events", "worker-b", handler);

    await bus.emit("order-events", { seq: 1 }, { key: "ord_42" });
    await bus.emit("order-events", { seq: 2 }, { key: "ord_42" });

    // Concurrent drains: without key locking both messages would be inflight.
    const d1 = bus.drain();
    const d2 = bus.drain();
    await started.promise;
    await Promise.all([d1, d2]);

    expect(maxInflight).toBe(1);
    expect(completed).toEqual([1, 2]);
  });

  test("different keys: may process concurrently", async () => {
    const once = signal("order-events", {
      delivery: "once",
      retries: 3,
      deadLetter: true,
    });
    const bus = await memorySignalDriver.open({
      signals: new Map([[once.name, once]]),
    });
    openBuses.push(bus);

    let inflight = 0;
    let maxInflight = 0;
    const gate = Promise.withResolvers<void>();
    let waiting = 0;

    const handler = async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      waiting += 1;
      if (waiting === 2) gate.resolve();
      await gate.promise;
      inflight -= 1;
    };

    await bus.subscribe("order-events", "worker-a", handler);
    await bus.subscribe("order-events", "worker-b", handler);

    await bus.emit("order-events", { seq: 1 }, { key: "ord_a" });
    await bus.emit("order-events", { seq: 2 }, { key: "ord_b" });

    await Promise.all([bus.drain(), bus.drain()]);
    expect(maxInflight).toBe(2);
  });

  test("no key: unchanged competing-consumer (both may run concurrent)", async () => {
    const once = signal("order-events", {
      delivery: "once",
      retries: 3,
      deadLetter: true,
    });
    const bus = await memorySignalDriver.open({
      signals: new Map([[once.name, once]]),
    });
    openBuses.push(bus);

    let inflight = 0;
    let maxInflight = 0;
    const gate = Promise.withResolvers<void>();
    let waiting = 0;

    const handler = async () => {
      inflight += 1;
      maxInflight = Math.max(maxInflight, inflight);
      waiting += 1;
      if (waiting === 2) gate.resolve();
      await gate.promise;
      inflight -= 1;
    };

    await bus.subscribe("order-events", "worker-a", handler);
    await bus.subscribe("order-events", "worker-b", handler);

    await bus.emit("order-events", { seq: 1 });
    await bus.emit("order-events", { seq: 2 });

    await Promise.all([bus.drain(), bus.drain()]);
    expect(maxInflight).toBe(2);
  });
});

describe("signal key ordering · postgres", () => {
  test("same-key pending blocked while sibling holds unexpired lease", async () => {
    let t = 10_000;
    const once = signal("order-events", { delivery: "once", retries: 3 });
    const sql = createPostgresSignalFake({ now: () => t });
    const runtime = createSignalRuntime({
      driver: postgresSignalDriver,
      sql,
      now: () => t,
      leaseMs: 50,
    });
    closers.push(runtime);
    runtime.register(once);
    const bus = await runtime.start();

    // msg1 holds the key via message-level lease; msg2 is pending same key.
    await sql.exec(
      `INSERT INTO oke_signal_messages (id, signal, payload, ordering_key, delivery, attempts, failures, created_at, available_at, status, locked_by, lease_expires_at, delivered_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "m1",
        "order-events",
        JSON.stringify({ seq: 1 }),
        "ord_42",
        "once",
        1,
        "[]",
        t - 2_000,
        t - 2_000,
        "inflight",
        "dead-worker",
        t + 1_000,
        "[]",
      ],
    );
    await sql.exec(
      `INSERT INTO oke_signal_messages (id, signal, payload, ordering_key, delivery, attempts, failures, created_at, available_at, status, locked_by, lease_expires_at, delivered_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "m2",
        "order-events",
        JSON.stringify({ seq: 2 }),
        "ord_42",
        "once",
        0,
        "[]",
        t - 1_000,
        t - 1_000,
        "pending",
        null,
        null,
        "[]",
      ],
    );

    const got: number[] = [];
    await bus.subscribe("order-events", "rescue", async (m) => {
      got.push((m.payload as { seq: number }).seq);
    });

    await bus.drain();
    expect(got).toEqual([]);

    // Same lease clock unlocks the key — no second timeout system.
    t = 10_000 + 1_001;
    await bus.drain();
    expect(got).toEqual([1, 2]);
  });

  test("emit with key then drain preserves emission order", async () => {
    const once = signal("order-events", {
      delivery: "once",
      retries: 3,
      deadLetter: true,
    });
    const bus = await postgresSignalDriver.open({
      signals: new Map([[once.name, once]]),
      sql: createPostgresSignalFake(),
    });
    openBuses.push(bus);

    const completed: number[] = [];
    await bus.subscribe("order-events", "worker-a", async (m) => {
      completed.push((m.payload as { seq: number }).seq);
    });
    await bus.subscribe("order-events", "worker-b", async (m) => {
      completed.push((m.payload as { seq: number }).seq);
    });

    await bus.emit("order-events", { seq: 1 }, { key: "ord_42" });
    await bus.emit("order-events", { seq: 2 }, { key: "ord_42" });
    await bus.drain();
    expect(completed).toEqual([1, 2]);
  });
});

describe("signal key ordering · lease reclaim", () => {
  test("memory: expired same-key inflight reclaims; successor then runs", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-key-lease-"));
    const durablePath = join(dir, "bus.json");
    const marker = join(dir, "claimed");
    try {
      let t = 5_000;
      const once = signal("order-events", {
        delivery: "once",
        retries: 3,
        deadLetter: true,
      });
      const r1 = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
        now: () => t,
        leaseMs: 50,
      });
      closers.push(r1);
      r1.register(once);
      const b1 = await r1.start();

      await b1.subscribe("order-events", "slow", async (m) => {
        if ((m.payload as { seq: number }).seq === 1) {
          await Bun.write(marker, "1");
          await Bun.sleep(60_000);
        }
      });

      await b1.emit("order-events", { seq: 1 }, { key: "ord_42" });
      await b1.emit("order-events", { seq: 2 }, { key: "ord_42" });

      const drainPromise = b1.drain();
      for (let i = 0; i < 80; i++) {
        if (await Bun.file(marker).exists()) break;
        await Bun.sleep(5);
      }
      expect(await Bun.file(marker).exists()).toBe(true);

      // Crash while holding the key lock (message-level lease).
      await r1.close();
      void drainPromise.catch(() => {});
      closers.pop();

      t = 5_000 + 100; // past leaseMs — same reclaim clock as unkeyed once
      const r2 = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
        now: () => t,
        leaseMs: 50,
      });
      closers.push(r2);
      r2.register(once);
      const b2 = await r2.start();
      const got: number[] = [];
      await b2.subscribe("order-events", "rescue", async (m) => {
        got.push((m.payload as { seq: number }).seq);
      });
      await b2.drain();
      expect(got).toEqual([1, 2]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
