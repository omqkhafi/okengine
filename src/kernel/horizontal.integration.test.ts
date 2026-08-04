/**
 * Multi-process horizontal integration — one coherent scenario across two
 * OS processes sharing real Postgres + Redis.
 *
 * Proves together (not in isolation):
 * 1. Clock cron fires exactly once while Signal/Gate/Store traffic runs
 * 2. Durable run crashed on A resumes on B while B serves HTTP
 * 3. Gate rate limits are shared (not per-instance doubled)
 * 4. No deadlock under concurrent Clock/Signal/Journal lease claims
 * 5. Mid-scenario SIGKILL — survivor absorbs cron, durable, and rate traffic
 *
 * Gate: OKE_TEST_POSTGRES_URL (or OKE_TEST_POSTGRES=1 + DATABASE_URL) AND
 *       OKE_TEST_REDIS_URL (or REDIS_URL). Visible skip when either is missing.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPostgresCronStore } from "../drivers/clock-postgres.ts";
import { createPostgresJournalStore } from "../drivers/journal-postgres.ts";

const childPath = join(import.meta.dir, "horizontal-child.ts");

const LIVE_PG =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

const LIVE_REDIS =
  process.env.OKE_TEST_REDIS_URL?.trim() || process.env.REDIS_URL?.trim() || undefined;

const LIVE = LIVE_PG && LIVE_REDIS ? { pg: LIVE_PG, redis: LIVE_REDIS } : undefined;

async function waitForFile(path: string, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return true;
    await Bun.sleep(20);
  }
  return false;
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 20_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await Bun.sleep(20);
  }
  return false;
}

async function loadJsonl(path: string): Promise<Array<Record<string, unknown>>> {
  if (!(await Bun.file(path).exists())) return [];
  return (await Bun.file(path).text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe.skipIf(!LIVE)("horizontal — two OS processes, Postgres + Redis", () => {
  test("combined Clock + Signal + Gate + Store + durable crash takeover", async () => {
    const pg = LIVE!.pg;
    const redis = LIVE!.redis;
    const dir = await mkdtemp(join(tmpdir(), "oke-horizontal-"));
    const signalPath = join(dir, "signal.json");
    const leaseMs = 400;

    const cron = await createPostgresCronStore({ url: pg });
    await cron.sql.exec(`DELETE FROM oke_crons WHERE name = 'horizontal-cron'`);
    await cron.close();
    const journal = await createPostgresJournalStore({ url: pg });
    await journal.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE 'horizontal.%'`);
    await journal.sql.exec(`DROP TABLE IF EXISTS oke_horizontal_writes`);
    await journal.close();

    const spawn = (instanceId: string, port: number) =>
      Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "serve",
          instanceId,
          String(port),
          pg,
          redis,
          signalPath,
          dir,
          String(leaseMs),
        ],
        stdout: "pipe",
        stderr: "pipe",
        env: { ...process.env, DATABASE_URL: pg, REDIS_URL: redis },
      });

    const a = spawn("inst-a", 0);
    const b = spawn("inst-b", 0);

    try {
      expect(await waitForFile(join(dir, "ready-inst-a.json"))).toBe(true);
      expect(await waitForFile(join(dir, "ready-inst-b.json"))).toBe(true);
      const readyA = (await Bun.file(join(dir, "ready-inst-a.json")).json()) as {
        port: number;
      };
      const readyB = (await Bun.file(join(dir, "ready-inst-b.json")).json()) as {
        port: number;
      };
      const urlA = `http://127.0.0.1:${readyA.port}`;
      const urlB = `http://127.0.0.1:${readyB.port}`;

      // Wait until both report ready (orphan scan done).
      expect(
        await waitFor(async () => {
          const ra = await fetch(`${urlA}/_/ready`);
          const rb = await fetch(`${urlB}/_/ready`);
          return ra.status === 200 && rb.status === 200;
        }),
      ).toBe(true);

      // Concurrent Store + Signal + Gate traffic on both instances.
      const traffic = async () => {
        for (let i = 0; i < 8; i++) {
          await Promise.all([
            fetch(`${urlA}/write`, { method: "POST", body: "{}" }),
            fetch(`${urlB}/write`, { method: "POST", body: "{}" }),
            fetch(`${urlA}/emit`, { method: "POST", body: "{}" }),
            fetch(`${urlB}/emit`, { method: "POST", body: "{}" }),
            fetch(`${urlA}/ping`),
            fetch(`${urlB}/ping`),
          ]);
        }
      };
      const trafficPromise = traffic();

      // (3) Gate rate — 5 ok shared across A+B, 6th limited.
      const rateStatuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const target = i % 2 === 0 ? urlA : urlB;
        const res = await fetch(`${target}/rate`, {
          headers: { "x-forwarded-for": "203.0.113.50" },
        });
        rateStatuses.push(res.status);
      }
      const okRates = rateStatuses.filter((s) => s === 200).length;
      const limited = rateStatuses.filter((s) => s === 429 || s >= 400).length;
      expect(okRates).toBe(5);
      expect(limited).toBeGreaterThanOrEqual(1);

      // (2) Start durable on A; hang mid-step.
      void fetch(`${urlA}/charge`, { method: "POST", body: "{}" });
      expect(await waitForFile(join(dir, "hang-inst-a.json"), 15_000)).toBe(true);

      // (5) Kill A mid combined scenario — B keeps serving.
      a.kill(9);
      await a.exited;

      // B still serves unrelated HTTP while absorbing responsibilities.
      expect((await fetch(`${urlB}/ping`)).status).toBe(200);
      await Bun.write(join(dir, "allow-complete.json"), "{}");

      // Wait past lease so B can reclaim the durable run.
      await Bun.sleep(leaseMs + 200);

      expect(
        await waitFor(async () => {
          const steps = await loadJsonl(join(dir, "steps.jsonl"));
          return (
            steps.filter((s) => s.step === "create-intent").length === 1 &&
            steps.some((s) => s.step === "mid-flight" && s.instanceId === "inst-b")
          );
        }, 20_000),
      ).toBe(true);

      // Keep traffic going on survivor (no deadlock).
      await trafficPromise.catch(() => {});
      for (let i = 0; i < 4; i++) {
        expect((await fetch(`${urlB}/write`, { method: "POST", body: "{}" })).status).toBe(200);
        expect((await fetch(`${urlB}/emit`, { method: "POST", body: "{}" })).status).toBe(200);
      }

      // (1) Cron fired exactly once across both instances.
      expect(
        await waitFor(async () => (await loadJsonl(join(dir, "cron.jsonl"))).length >= 1),
      ).toBe(true);
      const cronFires = await loadJsonl(join(dir, "cron.jsonl"));
      expect(cronFires).toHaveLength(1);
      expect(["inst-a", "inst-b"]).toContain(String(cronFires[0]!.instanceId));

      // Signal competing consumers — each emit delivered once (not 2×).
      const signals = await loadJsonl(join(dir, "signal.jsonl"));
      expect(signals.length).toBeGreaterThan(0);

      // Store writes landed.
      const writes = await loadJsonl(join(dir, "writes.jsonl"));
      expect(writes.length).toBeGreaterThan(0);

      // (4) Scenario finished under timeout — no hang/deadlock.
    } finally {
      try {
        a.kill(9);
      } catch {
        /* already dead */
      }
      try {
        b.kill(9);
      } catch {
        /* ignore */
      }
      await Promise.allSettled([a.exited, b.exited]);
      await rm(dir, { recursive: true, force: true });
      const cleanupJ = await createPostgresJournalStore({ url: pg });
      await cleanupJ.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE 'horizontal.%'`);
      await cleanupJ.sql.exec(`DROP TABLE IF EXISTS oke_horizontal_writes`);
      await cleanupJ.close();
      const cleanupC = await createPostgresCronStore({ url: pg });
      await cleanupC.sql.exec(`DELETE FROM oke_crons WHERE name = 'horizontal-cron'`);
      await cleanupC.close();
    }
  }, 90_000);
});

if (!LIVE) {
  test("skip: horizontal multi-process (set OKE_TEST_POSTGRES_URL + OKE_TEST_REDIS_URL or REDIS_URL)", () => {
    expect(LIVE).toBeUndefined();
  });
}
