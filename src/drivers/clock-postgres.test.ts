/**
 * Postgres CronStore — unit (fake) + live multi-process chaos.
 *
 * Live suite: set `OKE_TEST_POSTGRES_URL` (or `OKE_TEST_POSTGRES=1` + `DATABASE_URL`).
 * Without a live Postgres the chaos describe skips visibly.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { clock } from "../elements/clock/declare.ts";
import { createClockRuntime } from "../elements/clock/runtime.ts";
import { createPostgresCronFake, createPostgresCronStore } from "./clock-postgres.ts";

const childPath = join(import.meta.dir, "../elements/clock/chaos-child.ts");

const LIVE_URL =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

describe("postgres CronStore (fake)", () => {
  test("put / get / list round-trip", async () => {
    const store = await createPostgresCronStore({ sql: createPostgresCronFake() });
    await store.put({
      name: "job",
      effectiveEvery: "1h",
      timezone: "UTC",
      overridable: false,
      status: "active",
    });
    const row = await store.get("job");
    expect(row?.name).toBe("job");
    expect(row?.effectiveEvery).toBe("1h");
    expect(await store.list()).toHaveLength(1);
    await store.close();
  });

  test("acquireLease: exactly one of two racing claimants wins", async () => {
    const fake = createPostgresCronFake();
    const store = await createPostgresCronStore({ sql: fake });
    await store.put({
      name: "race",
      effectiveEvery: "1h",
      timezone: "UTC",
      overridable: false,
      status: "active",
    });

    const now = 1_000;
    const leaseMs = 500;
    // Overlap transactions: start both begins concurrently via fake's
    // sequential begin — second joins only when nested; here we race
    // two top-level acquires after seeding.
    const a = store.acquireLease("race", "a", now, leaseMs);
    const b = store.acquireLease("race", "b", now, leaseMs);
    const [wa, wb] = await Promise.all([a, b]);
    expect([wa, wb].filter(Boolean)).toHaveLength(1);

    const row = await store.get("race");
    expect(row?.leaderInstanceId).toBe(wa ? "a" : "b");
    expect(row?.leaderLeaseUntil).toBe(now + leaseMs);
    await store.close();
  });

  test("acquireLease: expired lease is reclaimed lazily (no sweeper)", async () => {
    const store = await createPostgresCronStore({ sql: createPostgresCronFake() });
    await store.put({
      name: "reclaim",
      effectiveEvery: "1h",
      timezone: "UTC",
      overridable: false,
      status: "active",
      leaderInstanceId: "dead",
      leaderLeaseUntil: 100,
    });

    expect(await store.acquireLease("reclaim", "survivor", 100, 50)).toBe(true);
    const row = await store.get("reclaim");
    expect(row?.leaderInstanceId).toBe("survivor");
    expect(row?.leaderLeaseUntil).toBe(150);
    await store.close();
  });

  test("acquireLease: live lease blocks other instance", async () => {
    const store = await createPostgresCronStore({ sql: createPostgresCronFake() });
    await store.put({
      name: "held",
      effectiveEvery: "1h",
      timezone: "UTC",
      overridable: false,
      status: "active",
    });
    expect(await store.acquireLease("held", "leader", 0, 1_000)).toBe(true);
    expect(await store.acquireLease("held", "other", 100, 1_000)).toBe(false);
    // Same holder may renew.
    expect(await store.acquireLease("held", "leader", 100, 1_000)).toBe(true);
    await store.close();
  });

  test("runtime: two instances fire a due tick once", async () => {
    const store = await createPostgresCronStore({ sql: createPostgresCronFake() });
    const fires: string[] = [];
    const a = createClockRuntime({ instanceId: "a", store, leaseMs: 200 });
    const b = createClockRuntime({ instanceId: "b", store, leaseMs: 200 });
    a.register(clock("once", { every: "1h" }));
    b.register(clock("once", { every: "1h" }));
    await a.reconcile();
    a.onCron("once", () => {
      fires.push("a");
    });
    b.onCron("once", () => {
      fires.push("b");
    });
    const [ra, rb] = await Promise.all([a.tick(), b.tick()]);
    expect([...ra.ran, ...rb.ran].filter((n) => n === "once")).toHaveLength(1);
    expect(fires).toHaveLength(1);
    await store.close();
  });
});

describe.skipIf(!LIVE_URL)("chaos — postgres CronStore multi-process", () => {
  test("two OS processes fire exactly once (no shared filesystem)", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-clock-pg-leader-"));
    const fireLogPath = join(dir, "fires.jsonl");
    const leaseMs = 200;
    const schemaStore = await createPostgresCronStore({ url });
    // Isolate this run from prior leftovers.
    await schemaStore.sql.exec(`DELETE FROM oke_crons WHERE name = ?`, ["chaos-job"]);
    await schemaStore.close();

    try {
      const a = Bun.spawn({
        cmd: ["bun", childPath, "tick-loop-pg", url, "inst-a", fireLogPath, String(leaseMs), "1h"],
        stdout: "pipe",
        stderr: "pipe",
      });
      const b = Bun.spawn({
        cmd: ["bun", childPath, "tick-loop-pg", url, "inst-b", fireLogPath, String(leaseMs), "1h"],
        stdout: "pipe",
        stderr: "pipe",
      });

      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await Bun.file(fireLogPath).exists()) {
          const text = await Bun.file(fireLogPath).text();
          if (text.trim().split("\n").filter(Boolean).length >= 1) break;
        }
        await Bun.sleep(20);
      }
      a.kill(9);
      b.kill(9);
      await Promise.all([a.exited, b.exited]);

      expect(await Bun.file(fireLogPath).exists()).toBe(true);
      const lines = (await Bun.file(fireLogPath).text()).trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const fire = JSON.parse(lines[0]!) as { instanceId: string };
      expect(["inst-a", "inst-b"]).toContain(fire.instanceId);
    } finally {
      await rm(dir, { recursive: true, force: true });
      const cleanup = await createPostgresCronStore({ url });
      await cleanup.sql.exec(`DELETE FROM oke_crons WHERE name = ?`, ["chaos-job"]);
      await cleanup.close();
    }
  });

  test("SIGKILL leader mid-lease: survivor takes over; report real latency", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-clock-pg-takeover-"));
    const markerPath = join(dir, "held.json");
    const fireLogPath = join(dir, "fires.jsonl");
    const leaseMs = 120;
    const tickSlackMs = 400;

    const schemaStore = await createPostgresCronStore({ url });
    await schemaStore.sql.exec(`DELETE FROM oke_crons WHERE name = ?`, ["chaos-job"]);
    await schemaStore.close();

    async function waitForFile(path: string, timeoutMs = 15_000): Promise<boolean> {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (await Bun.file(path).exists()) return true;
        await Bun.sleep(10);
      }
      return false;
    }

    try {
      const leader = Bun.spawn({
        cmd: ["bun", childPath, "hold-lease-pg", url, "leader", markerPath, String(leaseMs)],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await waitForFile(markerPath)).toBe(true);
      const held = (await Bun.file(markerPath).json()) as {
        leaderLeaseUntil?: number;
        heldAt: number;
      };

      const killAt = Date.now();
      leader.kill(9);
      await leader.exited;

      const survivor = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "tick-loop-pg",
          url,
          "survivor",
          fireLogPath,
          String(leaseMs),
          "50ms",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await survivor.exited).toBe(0);

      expect(await Bun.file(fireLogPath).exists()).toBe(true);
      const lines = (await Bun.file(fireLogPath).text()).trim().split("\n").filter(Boolean);
      expect(lines).toHaveLength(1);
      const fire = JSON.parse(lines[0]!) as { instanceId: string; firedAt: number };
      expect(fire.instanceId).toBe("survivor");

      const takeoverMs = fire.firedAt - killAt;
      const leaseRemainingAtKill = Math.max(
        0,
        (held.leaderLeaseUntil ?? killAt + leaseMs) - killAt,
      );
      expect(takeoverMs).toBeGreaterThanOrEqual(Math.max(0, leaseRemainingAtKill - 40));
      expect(takeoverMs).toBeLessThanOrEqual(leaseMs + tickSlackMs);

      console.log(
        `[clock postgres takeover] measured=${takeoverMs}ms leaseMs=${leaseMs} leaseRemainingAtKill=${leaseRemainingAtKill}ms`,
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
      const cleanup = await createPostgresCronStore({ url });
      await cleanup.sql.exec(`DELETE FROM oke_crons WHERE name = ?`, ["chaos-job"]);
      await cleanup.close();
    }
  });
});

// Visible skip reason when the live gate is off (describe.skipIf hides the body).
if (!LIVE_URL) {
  console.log(
    "skip: postgres CronStore chaos (set OKE_TEST_POSTGRES_URL or OKE_TEST_POSTGRES=1 + DATABASE_URL)",
  );
}
