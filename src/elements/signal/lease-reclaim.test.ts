/**
 * Lazy lease reclaim at claim time — no background sweeper.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPostgresSignalFake,
  memorySignalDriver,
  postgresSignalDriver,
} from "../../drivers/index.ts";
import { signal } from "./declare.ts";
import { createSignalRuntime } from "./runtime.ts";

const closers: Array<{ close(): Promise<void> }> = [];

afterEach(async () => {
  while (closers.length) {
    await closers.pop()!.close();
  }
});

describe("signal lease reclaim", () => {
  test("memory: expired inflight is reclaimed at next claim after crash", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-lease-"));
    const durablePath = join(dir, "bus.json");
    const marker = join(dir, "claimed");
    try {
      let t = 5_000;
      const once = signal("order-placed", {
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
      await b1.subscribe("order-placed", "slow", async () => {
        await Bun.write(marker, "1");
        await Bun.sleep(60_000);
      });
      await b1.emit("order-placed", { n: 42 });
      const drainPromise = b1.drain();
      for (let i = 0; i < 80; i++) {
        if (await Bun.file(marker).exists()) break;
        await Bun.sleep(5);
      }
      expect(await Bun.file(marker).exists()).toBe(true);
      // Strand the inflight claim (persisted before handler) by closing the bus.
      await r1.close();
      void drainPromise.catch(() => {});
      closers.pop();

      t = 5_000 + 100; // past leaseMs
      const r2 = createSignalRuntime({
        driver: memorySignalDriver,
        durablePath,
        now: () => t,
        leaseMs: 50,
      });
      closers.push(r2);
      r2.register(once);
      const b2 = await r2.start();
      const got: unknown[] = [];
      await b2.subscribe("order-placed", "rescue", async (m) => {
        got.push(m.payload);
      });
      await b2.drain();
      expect(got).toEqual([{ n: 42 }]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("postgres: expired inflight reclaimed in the same claim query", async () => {
    let t = 10_000;
    const once = signal("order-placed", { delivery: "once", retries: 3 });
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

    await sql.exec(
      `INSERT INTO oke_signal_messages (id, signal, payload, delivery, attempts, failures, created_at, available_at, status, locked_by, lease_expires_at, delivered_to) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        "stranded-1",
        "order-placed",
        JSON.stringify({ id: "stranded" }),
        "once",
        1,
        "[]",
        t - 1_000,
        t - 1_000,
        "inflight",
        "dead-worker",
        t - 1,
        "[]",
      ],
    );

    const got: unknown[] = [];
    await bus.subscribe("order-placed", "rescue", async (m) => {
      got.push(m.payload);
    });
    await bus.drain();
    expect(got).toEqual([{ id: "stranded" }]);
  });
});
