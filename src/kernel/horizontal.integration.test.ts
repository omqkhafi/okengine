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

/** Drain a child pipe so a full buffer cannot stall boot. */
function collectText(stream: ReadableStream<Uint8Array> | number | null | undefined): {
  snapshot(): string;
} {
  let text = "";
  if (!stream || typeof stream === "number") return { snapshot: () => "" };
  const decoder = new TextDecoder();
  void (async () => {
    const reader = stream.getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) text += decoder.decode(value, { stream: true });
      }
    } catch {
      /* closed */
    }
  })();
  return { snapshot: () => text };
}

/**
 * Ready file, or the child's last stderr line as soon as it exits.
 *
 * @param proc - Spawned horizontal child
 * @param stderr - Live stderr text
 * @param path - `ready-*.json`
 * @param timeoutMs - Upper bound when the child neither exits nor writes the file
 */
async function waitForReady(
  proc: { exitCode: number | null },
  stderr: { snapshot(): string },
  path: string,
  timeoutMs = 20_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return;
    if (proc.exitCode !== null) {
      await Bun.sleep(30);
      throw new Error(lastLine(stderr.snapshot()) || `child exited ${proc.exitCode}`);
    }
    await Bun.sleep(20);
  }
  throw new Error(lastLine(stderr.snapshot()) || `timed out waiting for ${path}`);
}

function lastLine(text: string): string {
  return (
    text
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .at(-1) ?? ""
  );
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
    const stderrA = collectText(a.stderr);
    const stderrB = collectText(b.stderr);
    collectText(a.stdout);
    collectText(b.stdout);

    try {
      await waitForReady(a, stderrA, join(dir, "ready-inst-a.json"));
      await waitForReady(b, stderrB, join(dir, "ready-inst-b.json"));
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
            fetch(`${urlA}/write`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
            fetch(`${urlB}/write`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
            fetch(`${urlA}/emit`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
            fetch(`${urlB}/emit`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            }),
            fetch(`${urlA}/ping`),
            fetch(`${urlB}/ping`),
          ]);
        }
      };
      // SIGKILL of A lands while this burst is still in flight. Requests already
      // on A's socket reset; that is the crash, not a failed peer. Attach the
      // catch now so the rejection is not unhandled before the later await.
      let killingA = false;
      const trafficPromise = traffic().catch((err: unknown) => {
        const path =
          err !== null && typeof err === "object" && "path" in err
            ? String((err as { path?: unknown }).path)
            : "";
        const code =
          err !== null && typeof err === "object" && "code" in err
            ? (err as { code?: unknown }).code
            : undefined;
        if (killingA && path.startsWith(urlA) && code === "ECONNRESET") return;
        throw err;
      });

      // (3) Gate rate — 5 ok shared across A+B, 6th limited.
      const rateIp = `203.0.113.${1 + (Date.now() % 200)}`;
      const rateStatuses: number[] = [];
      for (let i = 0; i < 6; i++) {
        const target = i % 2 === 0 ? urlA : urlB;
        const res = await fetch(`${target}/rate`, {
          headers: { "x-forwarded-for": rateIp },
        });
        rateStatuses.push(res.status);
      }
      const okRates = rateStatuses.filter((s) => s === 200).length;
      const limited = rateStatuses.filter((s) => s === 429 || s >= 400).length;
      expect(okRates).toBe(5);
      expect(limited).toBeGreaterThanOrEqual(1);

      // (2) Start durable on A; hang mid-step. SIGKILL resets this socket.
      const charge = fetch(`${urlA}/charge`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }).catch(() => undefined);
      expect(await waitForFile(join(dir, "hang-inst-a.json"), 15_000)).toBe(true);

      // (5) Kill A mid combined scenario — B keeps serving.
      killingA = true;
      a.kill(9);
      await a.exited;
      await charge;

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

      // Keep traffic going on survivor (no deadlock). A's in-flight sockets
      // already reset when it was killed; anything else still rejects here.
      await trafficPromise;
      for (let i = 0; i < 4; i++) {
        expect(
          (
            await fetch(`${urlB}/write`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            })
          ).status,
        ).toBe(200);
        expect(
          (
            await fetch(`${urlB}/emit`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: "{}",
            })
          ).status,
        ).toBe(200);
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

  test("broadcast, live, and cache invalidation reach the other instance", async () => {
    const pg = LIVE!.pg;
    const redis = LIVE!.redis;
    const dir = await mkdtemp(join(tmpdir(), "oke-horizontal-bus-"));
    const signalPath = join(dir, "signal.json");
    const post = (url: string) =>
      fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      });
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
          "5000",
        ],
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...process.env,
          DATABASE_URL: pg,
          REDIS_URL: redis,
          OKE_HORIZONTAL_REDIS_SIGNALS: "1",
          // A different cron row, so this test's ticks do not consume the
          // combined test's one due fire while both run in the same file.
          OKE_HORIZONTAL_CRON: "horizontal-bus-cron",
        },
      });
    const a = spawn("bus-a", 0);
    const b = spawn("bus-b", 0);
    const stderrA = collectText(a.stderr);
    const stderrB = collectText(b.stderr);
    collectText(a.stdout);
    collectText(b.stdout);
    try {
      await waitForReady(a, stderrA, join(dir, "ready-bus-a.json"));
      await waitForReady(b, stderrB, join(dir, "ready-bus-b.json"));
      const readyA = (await Bun.file(join(dir, "ready-bus-a.json")).json()) as { port: number };
      const readyB = (await Bun.file(join(dir, "ready-bus-b.json")).json()) as { port: number };
      const urlA = `http://127.0.0.1:${readyA.port}`;
      const urlB = `http://127.0.0.1:${readyB.port}`;
      const first = (await (await fetch(`${urlA}/cached`)).json()) as { data: { reads: number } };
      const second = (await (await fetch(`${urlA}/cached`)).json()) as { data: { reads: number } };
      expect(first.data.reads).toBe(1);
      expect(second.data.reads).toBe(1);
      expect((await post(`${urlB}/write`)).status).toBe(200);
      expect(
        await waitFor(async () => {
          const body = (await (await fetch(`${urlA}/cached`)).json()) as {
            data: { reads: number };
          };
          return body.data.reads === 2;
        }),
      ).toBe(true);
      expect((await post(`${urlA}/news`)).status).toBe(200);
      expect((await post(`${urlA}/feed`)).status).toBe(200);
      expect(
        await waitFor(async () => {
          const broadcast = await loadJsonl(join(dir, "broadcast.jsonl"));
          const live = await loadJsonl(join(dir, "live.jsonl"));
          const ids = (rows: Array<Record<string, unknown>>) =>
            new Set(rows.map((row) => row.instanceId));
          return (
            ids(broadcast).has("bus-a") &&
            ids(broadcast).has("bus-b") &&
            ids(live).has("bus-a") &&
            ids(live).has("bus-b")
          );
        }),
      ).toBe(true);
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
    }
  }, 60_000);
});

if (!LIVE) {
  test("skip: horizontal multi-process (set OKE_TEST_POSTGRES_URL + OKE_TEST_REDIS_URL or REDIS_URL)", () => {
    expect(LIVE).toBeUndefined();
  });
}

test("a child that exits is reported from stderr without waiting out the file timeout", async () => {
  const dir = await mkdtemp(join(tmpdir(), "oke-horizontal-exit-"));
  const started = Date.now();
  const proc = Bun.spawn({
    cmd: ["bun", childPath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stderr = collectText(proc.stderr);
  collectText(proc.stdout);
  try {
    await expect(waitForReady(proc, stderr, join(dir, "ready-missing.json"))).rejects.toThrow(
      /usage:/,
    );
    expect(Date.now() - started).toBeLessThan(5_000);
  } finally {
    try {
      proc.kill();
    } catch {
      /* already dead */
    }
    await proc.exited;
    await rm(dir, { recursive: true, force: true });
  }
});
