/**
 * Signal element acceptance:
 * - delivery is mandatory with no default
 * - rolled-back transaction emits nothing
 * - crash between write and emit loses nothing (transactional outbox)
 * - competing consumers under once receive each message once
 * - broadcast reaches every subscriber
 * - live is client-subscribable
 * - DLQ preserves typed failure reasons per attempt
 * - redis / nats keep an outbox relay (semantics never regress)
 * - chaos: kill process mid-transaction; SIGKILL after claim + lease reclaim
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
} from "../drivers/index.ts";
import { createFx } from "../kernel/fx.ts";
import { signal, createSignalRuntime, type SignalDecl } from "./signal.ts";

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

describe("signal declaration", () => {
  test("delivery is mandatory with no default", () => {
    expect(() =>
      // @ts-expect-error delivery is required
      signal("x", { retries: 1 }),
    ).toThrow(/delivery is mandatory/);

    const s = signal("order-placed", { delivery: "once" });
    expect(s.delivery).toBe("once");
    expect(s.name).toBe("order-placed");
  });
});

for (const { label, driver, setup } of drivers) {
  describe(`signal driver · ${label}`, () => {
    test("rolled-back transaction emits nothing", async () => {
      const once = signal("order-placed", { delivery: "once" });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      const seen: unknown[] = [];
      await bus.subscribe("order-placed", "c1", async (m) => {
        seen.push(m.payload);
      });

      const tx = await bus.begin();
      await tx.write("booking:1", { id: "1" });
      await tx.emit("order-placed", { id: "1" });
      await tx.rollback();

      await bus.drain();
      expect(seen).toEqual([]);
      expect(await bus.getWrite("booking:1")).toBeUndefined();
    });

    test("commit makes write + emit visible together", async () => {
      const once = signal("order-placed", { delivery: "once" });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      const seen: unknown[] = [];
      await bus.subscribe("order-placed", "c1", async (m) => {
        seen.push(m.payload);
      });

      const tx = await bus.begin();
      await tx.write("booking:1", { id: "1" });
      await tx.emit("order-placed", { id: "1" });
      await tx.commit();

      await bus.drain();
      expect(seen).toEqual([{ id: "1" }]);
      expect(await bus.getWrite("booking:1")).toEqual({ id: "1" });
    });

    test("competing consumers under once receive each message exactly once", async () => {
      const once = signal("order-placed", { delivery: "once", retries: 2 });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      const got: string[] = [];

      await bus.subscribe("order-placed", "worker-a", async (m) => {
        got.push(`a:${(m.payload as { n: number }).n}`);
      });
      await bus.subscribe("order-placed", "worker-b", async (m) => {
        got.push(`b:${(m.payload as { n: number }).n}`);
      });

      await bus.emit("order-placed", { n: 1 });
      await bus.emit("order-placed", { n: 2 });
      await bus.drain();

      expect(got).toHaveLength(2);
      expect(new Set(got).size).toBe(2);
      const numbers = got.map((g) => g.slice(2)).sort();
      expect(numbers).toEqual(["1", "2"]);
    });

    test("once: a single emit is received by exactly one of two consumers", async () => {
      const once = signal("order-placed", { delivery: "once", retries: 2 });
      const bus = await openBus(driver, [once], setup?.() ?? {});
      const got: string[] = [];
      await bus.subscribe("order-placed", "worker-a", async () => {
        got.push("a");
      });
      await bus.subscribe("order-placed", "worker-b", async () => {
        got.push("b");
      });
      await bus.emit("order-placed", { n: 1 });
      await bus.drain();
      expect(got).toHaveLength(1);
      expect(got[0] === "a" || got[0] === "b").toBe(true);
    });

    test("broadcast reaches every subscriber", async () => {
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

    test("live is client-subscribable", async () => {
      const live = signal("seat-feed", { delivery: "live" });
      const bus = await openBus(driver, [live], setup?.() ?? {});
      const frames: unknown[] = [];
      await bus.live("seat-feed", (payload) => {
        frames.push(payload);
      });

      await bus.emit("seat-feed", { seat: "12A" });
      await bus.drain();

      expect(frames).toEqual([{ seat: "12A" }]);
    });

    test("DLQ preserves typed failure reasons per attempt", async () => {
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

      const dlq = await bus.deadLetters("flaky");
      expect(dlq).toHaveLength(1);
      expect(dlq[0]!.failures.length).toBeGreaterThanOrEqual(2);
      expect(dlq[0]!.failures[0]).toMatchObject({
        code: "handler_error",
        attempt: 1,
      });
      expect(dlq[0]!.failures[0]!.message).toContain("boom-");
      expect(dlq[0]!.failures.map((f) => f.attempt)).toEqual(dlq[0]!.failures.map((_, i) => i + 1));
    });
  });
}

describe("postgres transactional emit (dual-write fix)", () => {
  test("fx.emit enrols in the caller's transaction via runtime", async () => {
    const orderPlaced = signal("order-placed", { delivery: "once" });
    const runtime = createSignalRuntime({
      driver: postgresSignalDriver,
      sql: createPostgresSignalFake(),
    });
    runtime.register(orderPlaced);
    const bus = await runtime.start();
    openBuses.push(bus);

    const seen: unknown[] = [];
    await bus.subscribe("order-placed", "c1", async (m) => {
      seen.push(m.payload);
    });

    const fx = createFx({
      flow: "bookings.create",
      effects: { emits: ["order-placed"] },
      signalRuntime: runtime,
    });

    await fx.emit(orderPlaced, { id: "42" });
    await bus.drain();
    expect(seen).toEqual([{ id: "42" }]);
  });

  test("LISTEN/NOTIFY wakes drain after commit", async () => {
    const sql = createPostgresSignalFake();
    const once = signal("order-placed", { delivery: "once" });
    const bus = await openBus(postgresSignalDriver, [once], { sql });
    const seen: unknown[] = [];
    await bus.subscribe("order-placed", "c1", async (m) => {
      seen.push(m.payload);
    });

    const notified: string[] = [];
    await sql.listen("oke_signal", (p) => {
      notified.push(p);
    });

    await bus.emit("order-placed", { id: "n1" });
    // Give the notify → drainQuiet microtask a tick.
    await Bun.sleep(5);
    expect(notified.length).toBeGreaterThan(0);
    expect(seen).toEqual([{ id: "n1" }]);
  });
});

describe("redis / nats outbox relay", () => {
  test("redis relay publishes after commit, not on rollback", async () => {
    const redis = createSignalRedisFake();
    const once = signal("order-placed", { delivery: "once", optional: true });
    const bus = await openBus(redisSignalDriver, [once], { redis });

    const tx = await bus.begin();
    await tx.emit("order-placed", { id: "r1" });
    await tx.rollback();
    expect(redis.streams.get("oke:signal:order-placed") ?? []).toHaveLength(0);

    await bus.emit("order-placed", { id: "r2" });
    const stream = redis.streams.get("oke:signal:order-placed") ?? [];
    expect(stream.length).toBe(1);
    expect(JSON.parse(stream[0]!.fields.payload ?? "null")).toEqual({
      id: "r2",
    });
  });

  test("nats relay publishes after commit, not on rollback", async () => {
    const nats = createSignalNatsFake();
    const once = signal("order-placed", { delivery: "once", optional: true });
    const bus = await openBus(natsSignalDriver, [once], { nats });

    const tx = await bus.begin();
    await tx.emit("order-placed", { id: "n1" });
    await tx.rollback();
    expect(nats.published).toHaveLength(0);

    await bus.emit("order-placed", { id: "n2" });
    expect(nats.published).toHaveLength(1);
    expect(nats.published[0]!.subject).toBe("oke.signal.order-placed.once");
    expect(JSON.parse(nats.published[0]!.data)).toEqual({ id: "n2" });
  });
});

describe("chaos — kill process mid-transaction", () => {
  test("killed mid-transaction emits nothing and loses the write", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-signal-chaos-"));
    const durablePath = join(dir, "bus.json");
    try {
      const child = Bun.spawn({
        cmd: ["bun", join(import.meta.dir, "signal/chaos-child.ts"), durablePath, "mid-txn"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const code = await child.exited;
      expect(code).toBe(99);

      // Recover: new process opens the same durable path.
      const orderPlaced = signal("order-placed", {
        delivery: "once",
        retries: 3,
        deadLetter: true,
      });
      const runtime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      runtime.register(orderPlaced);
      const bus = await runtime.start();
      openBuses.push(bus);

      const seen: unknown[] = [];
      await bus.subscribe("order-placed", "c1", async (m) => {
        seen.push(m.payload);
      });
      await bus.drain();

      expect(seen).toEqual([]);
      expect(await bus.getWrite("booking:1")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("SIGKILL mid-transaction loses nothing committed (dual-write safe)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-signal-chaos-kill-"));
    const durablePath = join(dir, "bus.json");
    try {
      const child = Bun.spawn({
        cmd: [
          "bun",
          "-e",
          `
          import { memorySignalDriver } from ${JSON.stringify(join(import.meta.dir, "../drivers/signal-memory.ts"))};
          import { signal } from ${JSON.stringify(join(import.meta.dir, "signal/declare.ts"))};
          import { createSignalRuntime } from ${JSON.stringify(join(import.meta.dir, "signal/runtime.ts"))};
          const orderPlaced = signal("order-placed", { delivery: "once", retries: 3, deadLetter: true, optional: true });
          const runtime = createSignalRuntime({ driver: memorySignalDriver, durablePath: ${JSON.stringify(durablePath)} });
          runtime.register(orderPlaced);
          const bus = await runtime.start();
          const tx = await bus.begin();
          await tx.write("booking:1", { id: "1" });
          await tx.emit("order-placed", { id: "1" });
          // Hang so parent can SIGKILL before commit.
          await Bun.sleep(60_000);
          `,
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      // Wait until the child has started the transaction (file may not exist yet).
      await Bun.sleep(150);
      child.kill(9);
      await child.exited;

      const orderPlaced = signal("order-placed", {
        delivery: "once",
        retries: 3,
        deadLetter: true,
      });
      const runtime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      runtime.register(orderPlaced);
      const bus = await runtime.start();
      openBuses.push(bus);

      const seen: unknown[] = [];
      await bus.subscribe("order-placed", "c1", async (m) => {
        seen.push(m.payload);
      });
      await bus.drain();

      // Nothing committed → nothing delivered, nothing written.
      expect(seen).toEqual([]);
      expect(await bus.getWrite("booking:1")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("committed write+emit survives process death (crash between systems loses nothing)", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-signal-chaos-ok-"));
    const durablePath = join(dir, "bus.json");
    try {
      const child = Bun.spawn({
        cmd: ["bun", join(import.meta.dir, "signal/chaos-child.ts"), durablePath, "commit"],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await child.exited).toBe(0);

      const orderPlaced = signal("order-placed", {
        delivery: "once",
        retries: 3,
        deadLetter: true,
      });
      const runtime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
      });
      runtime.register(orderPlaced);
      const bus = await runtime.start();
      openBuses.push(bus);

      const seen: unknown[] = [];
      await bus.subscribe("order-placed", "c1", async (m) => {
        seen.push(m.payload);
      });
      await bus.drain();

      expect(await bus.getWrite("booking:1")).toEqual({
        id: "1",
        status: "pending",
      });
      expect(seen).toEqual([{ id: "1" }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("SIGKILL after claim: committed message is reclaimed after lease expiry", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-signal-chaos-consume-"));
    const durablePath = join(dir, "bus.json");
    const markerPath = join(dir, "claimed");
    const leaseMs = 80;
    try {
      const commit = Bun.spawn({
        cmd: ["bun", join(import.meta.dir, "signal/chaos-child.ts"), durablePath, "commit"],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await commit.exited).toBe(0);

      const consumer = Bun.spawn({
        cmd: [
          "bun",
          join(import.meta.dir, "signal/chaos-child.ts"),
          durablePath,
          "consume-hang",
          markerPath,
          String(leaseMs),
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      for (let i = 0; i < 100; i++) {
        if (await Bun.file(markerPath).exists()) break;
        await Bun.sleep(10);
      }
      expect(await Bun.file(markerPath).exists()).toBe(true);
      consumer.kill(9);
      await consumer.exited;

      // Advance past the visibility lease so reclaim-at-claim can take the row.
      await Bun.sleep(leaseMs + 40);

      let clock = Date.now() + leaseMs + 1_000;
      const orderPlaced = signal("order-placed", {
        delivery: "once",
        retries: 3,
        deadLetter: true,
      });
      const runtime = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
        now: () => clock,
        leaseMs,
      });
      runtime.register(orderPlaced);
      const bus = await runtime.start();
      openBuses.push(bus);

      const seen: Array<{ payload: unknown; attempts: number }> = [];
      await bus.subscribe("order-placed", "rescue", async (m) => {
        seen.push({ payload: m.payload, attempts: m.attempts });
      });
      await bus.drain();

      expect(seen).toHaveLength(1);
      expect(seen[0]!.payload).toEqual({ id: "1" });
      // Original claim in the killed child + reclaim here.
      expect(seen[0]!.attempts).toBeGreaterThanOrEqual(2);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("protocol naming", () => {
  test("signal driver ids are protocols, never vendors", () => {
    expect(memorySignalDriver.id).toBe("memory");
    expect(postgresSignalDriver.id).toBe("postgres");
    expect(redisSignalDriver.id).toBe("redis");
    expect(natsSignalDriver.id).toBe("nats");
  });
});
