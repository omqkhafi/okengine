/**
 * Durable journal — boot-level acceptance.
 *
 * Fake suite: two `oke()` apps share one journal store in one process (the
 * store is injected as a prebuilt `elements.journal`; every other path —
 * boot bind, orphan scan, claimDueSleep, run lease — is the real boot path).
 * Covers same-instance crash, cross-instance failover, double-execution
 * prevention against the SKIP LOCKED fake.
 *
 * Live suite: real OS processes + real Postgres (chaos-child journal-pg-*),
 * gated on `OKE_TEST_POSTGRES_URL` (or `OKE_TEST_POSTGRES=1` + `DATABASE_URL`).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createPostgresJournalFake,
  createPostgresJournalStore,
  type PostgresJournalStore,
} from "../drivers/journal-postgres.ts";
import { oke, type OkeApp } from "./app.ts";
import type { JournalRuntime } from "./boot-bind/journal.ts";
import { flow, resetFlowSeq, type AnyFlowDef } from "./flow.ts";
import type { Binding } from "./on.ts";
import { http } from "./triggers.ts";

const childPath = join(import.meta.dir, "../elements/clock/chaos-child.ts");

const LIVE_URL =
  process.env.OKE_TEST_POSTGRES_URL?.trim() ||
  (process.env.OKE_TEST_POSTGRES === "1"
    ? (process.env.DATABASE_URL ?? process.env.OKE_STORE_SQL_URL)?.trim()
    : undefined);

function journalRuntime(
  store: PostgresJournalStore,
  instanceId: string,
  leaseMs = 120,
): JournalRuntime {
  return { store, instanceId, leaseMs, driverId: "postgres" };
}

async function bootDurableApp(options: {
  readonly name: string;
  readonly journal: JournalRuntime;
  readonly bindings: readonly Binding[];
}): Promise<OkeApp> {
  const app = oke({
    name: options.name,
    env: "test",
    startScheduler: false,
    gate: { unguardedHttp: "allow" },
    // Explicit bindings: the global on() registry is consumed by the first
    // oke() in the process — sibling apps need their own copies.
    bindings: [...options.bindings],
    elements: { journal: options.journal },
  });
  await app.boot();
  return app;
}

async function waitFor(cond: () => Promise<boolean>, timeoutMs = 5_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await Bun.sleep(10);
  }
  return false;
}

/** Flow whose step 2 blocks once per execution; the test unblocks survivors. */
function blockingFlow(step1Calls: string[], blockers: Array<() => void>): Binding {
  const charge = flow("charge", {
    durable: true,
    do: async (_input, fx) => {
      await fx.step("create-intent", () => {
        step1Calls.push("step1");
        return { id: "pi_1" };
      });
      await fx.step("mid-flight", async () => {
        // Every *execution* parks here; the test unblocks only the resume.
        await new Promise<void>((resolve) => {
          blockers.push(resolve);
        });
        return "done";
      });
      return { ok: true };
    },
  });
  return { trigger: http.post("/charge"), flow: charge as AnyFlowDef };
}

/** Flow that sleeps `wake`, then records one confirm execution. */
function sleeperBinding(wake: string, confirms: string[]): Binding {
  const sleeper = flow("sleeper", {
    durable: true,
    do: async (_input, fx) => {
      await fx.step("create-intent", () => ({ id: "pi_1" }));
      await fx.clock.sleep("verify-window", wake);
      await fx.step("confirm", () => {
        confirms.push("confirm");
        return true;
      });
      return { ok: true };
    },
  });
  return { trigger: http.post("/sleep"), flow: sleeper as AnyFlowDef };
}

describe("journal boot — shared store, real boot paths (fake SQL)", () => {
  afterEach(() => {
    resetFlowSeq();
  });

  test("same-instance crash: boot orphan scan resumes; completed step never re-runs", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const step1Calls: string[] = [];
    const blockers: Array<() => void> = [];
    const bindings = [blockingFlow(step1Calls, blockers)];

    const appA = await bootDurableApp({
      name: "a",
      journal: journalRuntime(store, "A", 120),
      bindings,
    });
    // Start the run through the real HTTP path; it hangs inside step 2.
    void appA.fetch(new Request("http://localhost/charge", { method: "POST", body: "{}" }));
    expect(await waitFor(async () => blockers.length === 1)).toBe(true);
    const runId = (await store.list())[0]!.id;
    // "Crash": no commit, no release — the lease (120ms) is left to expire.
    // appA is deliberately never stopped; its promise stays dangling.

    await Bun.sleep(300);
    const appB = await bootDurableApp({
      name: "b",
      journal: journalRuntime(store, "B", 120),
      bindings,
    });

    // Boot orphan scan (fire-and-forget) claims the expired lease and resumes.
    expect(await waitFor(async () => blockers.length === 2)).toBe(true);
    expect(step1Calls).toHaveLength(1); // completed step replayed, not re-run
    blockers[1]!(); // let the survivor finish

    expect(await waitFor(async () => (await store.get(runId))?.status === "completed")).toBe(true);
    expect((await store.get(runId))?.output).toEqual({ ok: true });
    // The in-flight (unpersisted) step ran twice — documented at-least-once law.
    expect(blockers).toHaveLength(2);
    expect(step1Calls).toHaveLength(1);

    await appB.stop();
  });

  test("cross-instance failover: a sleep parked by a dead instance wakes on the survivor", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const confirms: string[] = [];
    const bindings = [sleeperBinding("120ms", confirms)];

    const appA = await bootDurableApp({
      name: "a",
      journal: journalRuntime(store, "A", 5_000),
      bindings,
    });
    const parked = await appA.fetch(
      new Request("http://localhost/sleep", { method: "POST", body: "{}" }),
    );
    expect(parked.status).toBe(204); // durable park — lease released, row sleeping
    const runId = (await store.list())[0]!.id;
    // "Dead" instance A: parked runs hold no lease, so closing is crash-safe.
    await appA.stop();

    // Survivor boots while the sleep is still pending — orphan scan leaves it scheduled.
    const appB = await bootDurableApp({
      name: "b",
      journal: journalRuntime(store, "B", 5_000),
      bindings,
    });
    expect(confirms).toHaveLength(0);

    await Bun.sleep(200);
    await appB.resumeDurable(); // scheduler tick in production

    expect(confirms).toEqual(["confirm"]);
    expect((await store.get(runId))?.status).toBe("completed");
    await appB.stop();
  });

  test("double-execution prevention: two instances race one due sleep — exactly one runs it", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const confirms: string[] = [];
    const bindings = [sleeperBinding("300ms", confirms)];

    const appA = await bootDurableApp({
      name: "a",
      journal: journalRuntime(store, "A", 5_000),
      bindings,
    });
    await appA.fetch(new Request("http://localhost/sleep", { method: "POST", body: "{}" }));
    await appA.stop();

    // Both survivors boot while the sleep is future (orphan scan skips it).
    const appB = await bootDurableApp({
      name: "b",
      journal: journalRuntime(store, "B", 5_000),
      bindings,
    });
    const appC = await bootDurableApp({
      name: "c",
      journal: journalRuntime(store, "C", 5_000),
      bindings,
    });

    await Bun.sleep(400);
    await Promise.all([appB.resumeDurable(), appC.resumeDurable()]);

    expect(confirms).toHaveLength(1);
    await appB.stop();
    await appC.stop();
  });

  test("boot orphan scan skips runs held under a live lease", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const step1Calls: string[] = [];
    const blockers: Array<() => void> = [];
    const bindings = [blockingFlow(step1Calls, blockers)];

    // Long lease: A is slow but very much alive.
    const appA = await bootDurableApp({
      name: "a",
      journal: journalRuntime(store, "A", 30_000),
      bindings,
    });
    void appA.fetch(new Request("http://localhost/charge", { method: "POST", body: "{}" }));
    expect(await waitFor(async () => blockers.length === 1)).toBe(true);

    // B boots while A's lease is live — must not steal the run.
    const appB = await bootDurableApp({
      name: "b",
      journal: journalRuntime(store, "B", 30_000),
      bindings,
    });
    await Bun.sleep(150);
    expect(blockers).toHaveLength(1);
    expect(step1Calls).toHaveLength(1);

    blockers[0]!(); // A finishes cleanly.
    expect(await waitFor(async () => (await store.list())[0]?.status === "completed")).toBe(true);
    expect(step1Calls).toHaveLength(1);
    await appB.stop();
  });
});

describe.skipIf(!LIVE_URL)("chaos — postgres journal multi-process boot", () => {
  test("SIGKILL mid-run: survivor boot orphan scan resumes; completed step never re-runs", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-journal-pg-crash-"));
    const stepLogPath = join(dir, "steps.jsonl");
    const markerPath = join(dir, "started.json");
    const donePath = join(dir, "done.json");
    const leaseMs = 300;

    const schema = await createPostgresJournalStore({ url });
    await schema.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE 'chaos.journal.%'`);
    await schema.close();

    try {
      const doomed = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "journal-pg-start",
          url,
          "doomed",
          stepLogPath,
          markerPath,
          String(leaseMs),
          "60000",
        ],
        stdout: "pipe",
        stderr: "pipe",
      });

      expect(await waitForFile(markerPath)).toBe(true);
      doomed.kill(9);
      await doomed.exited;

      const survivor = Bun.spawn({
        cmd: [
          "bun",
          childPath,
          "journal-pg-resume",
          url,
          "survivor",
          stepLogPath,
          donePath,
          String(leaseMs),
        ],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await survivor.exited).toBe(0);

      const steps = (await Bun.file(stepLogPath).text())
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { instanceId: string; step: string });
      const step1 = steps.filter((s) => s.step === "create-intent");
      const step2 = steps.filter((s) => s.step === "mid-flight");
      expect(step1).toHaveLength(1); // completed step never re-ran — across processes
      expect(step1[0]!.instanceId).toBe("doomed");
      expect(step2).toHaveLength(1);
      expect(step2[0]!.instanceId).toBe("survivor");
      expect(await Bun.file(donePath).exists()).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
      const cleanup = await createPostgresJournalStore({ url });
      await cleanup.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE 'chaos.journal.%'`);
      await cleanup.close();
    }
  });

  test("two OS processes race one due sleep — exactly one executes it", async () => {
    const url = LIVE_URL!;
    const dir = await mkdtemp(join(tmpdir(), "oke-journal-pg-race-"));
    const stepLogPath = join(dir, "steps.jsonl");
    const parkedPath = join(dir, "parked.json");
    const leaseMs = 300;

    const schema = await createPostgresJournalStore({ url });
    await schema.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE 'chaos.journal.%'`);
    await schema.close();

    try {
      const seeder = Bun.spawn({
        cmd: ["bun", childPath, "journal-pg-park", url, "seeder", stepLogPath, parkedPath, "400"],
        stdout: "pipe",
        stderr: "pipe",
      });
      expect(await seeder.exited).toBe(0);
      expect(await Bun.file(parkedPath).exists()).toBe(true);

      await Bun.sleep(500); // let the sleep come due
      const claim = (instanceId: string) =>
        Bun.spawn({
          cmd: [
            "bun",
            childPath,
            "journal-pg-claim",
            url,
            instanceId,
            stepLogPath,
            String(leaseMs),
          ],
          stdout: "pipe",
          stderr: "pipe",
        });
      const b = claim("inst-b");
      const c = claim("inst-c");
      const [exitB, exitC] = await Promise.all([b.exited, c.exited]);
      expect([exitB, exitC].sort()).toEqual([0, 3]); // one claimed, one found nothing

      const steps = (await Bun.file(stepLogPath).text())
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as { instanceId: string; step: string });
      expect(steps.filter((s) => s.step === "confirm")).toHaveLength(1);
    } finally {
      await rm(dir, { recursive: true, force: true });
      const cleanup = await createPostgresJournalStore({ url });
      await cleanup.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE 'chaos.journal.%'`);
      await cleanup.close();
    }
  });
});

async function waitForFile(path: string, timeoutMs = 15_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await Bun.file(path).exists()) return true;
    await Bun.sleep(10);
  }
  return false;
}

// Visible skip reason when the live gate is off (describe.skipIf hides the body).
if (!LIVE_URL) {
  console.log(
    "skip: postgres journal boot chaos (set OKE_TEST_POSTGRES_URL or OKE_TEST_POSTGRES=1 + DATABASE_URL)",
  );
}
