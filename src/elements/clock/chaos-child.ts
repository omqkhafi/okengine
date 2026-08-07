/**
 * Clock chaos child — multi-process leader election / durable resume.
 *
 * Args:
 *   tick-loop <storePath> <instanceId> <fireLogPath> <leaseMs> [every]
 *   hold-lease <storePath> <instanceId> <markerPath> <leaseMs>
 *   tick-loop-pg <databaseUrl> <instanceId> <fireLogPath> <leaseMs> [every]
 *   hold-lease-pg <databaseUrl> <instanceId> <markerPath> <leaseMs>
 *   durable-mid-step <journalPath> <markerPath> <runIdPath>
 *   journal-pg-start <databaseUrl> <instanceId> <stepLogPath> <markerPath> <leaseMs> <blockMs>
 *   journal-pg-resume <databaseUrl> <instanceId> <stepLogPath> <donePath> <leaseMs>
 *   journal-pg-park <databaseUrl> <instanceId> <stepLogPath> <parkedPath> <wakeMs>
 *   journal-pg-claim <databaseUrl> <instanceId> <stepLogPath> <leaseMs>
 *
 * Modes:
 *   tick-loop / tick-loop-pg   — reconcile + tick until this instance fires once
 *   hold-lease / hold-lease-pg — acquire lease, write marker, hang (parent SIGKILLs)
 *   durable-mid-step           — journal step 1, write marker + runId, hang
 *   journal-pg-start           — boot oke() app, start durable run over HTTP, hang (parent SIGKILLs)
 *   journal-pg-resume          — boot oke() app; orphan sweep resumes the dead run; exit when done
 *   journal-pg-park            — boot oke() app, park a durable sleep over HTTP, exit
 *   journal-pg-claim           — boot oke() app; race claimDueSleep; exit 0 on own execution
 */

import { join } from "node:path";

import { createPostgresCronStore } from "../../drivers/clock-postgres.ts";
import { oke, type OkeApp } from "../../kernel/app.ts";
import { flow, type AnyFlowDef } from "../../kernel/flow.ts";
import { createFileJournalStore } from "../../kernel/journal.ts";
import { on } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { clock } from "./declare.ts";
import { runDurable } from "./durable.ts";
import { createFileCronStore, type CronStore } from "./reconcile.ts";
import { createClockRuntime } from "./runtime.ts";

const mode = process.argv[2];

if (!mode) {
  console.error(
    "usage: chaos-child <tick-loop|hold-lease|tick-loop-pg|hold-lease-pg|durable-mid-step> …",
  );
  process.exit(2);
}

const CRON_NAME = "chaos-job";

async function runTickLoop(
  store: CronStore,
  instanceId: string,
  fireLogPath: string,
  leaseMs: number,
  every: string,
) {
  const rt = createClockRuntime({
    instanceId,
    store,
    leaseMs: Number.isFinite(leaseMs) ? leaseMs : 100,
  });
  rt.register(clock(CRON_NAME, { every }));
  await rt.reconcile();
  rt.onCron(CRON_NAME, async () => {
    const line = `${JSON.stringify({ instanceId, firedAt: Date.now() })}\n`;
    const prev = (await Bun.file(fireLogPath).exists()) ? await Bun.file(fireLogPath).text() : "";
    await Bun.write(fireLogPath, prev + line);
  });

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { ran } = await rt.tick();
    if (ran.includes(CRON_NAME)) process.exit(0);
    await Bun.sleep(5);
  }
  console.error("tick-loop: timed out without firing");
  process.exit(3);
}

async function runHoldLease(
  store: CronStore,
  instanceId: string,
  markerPath: string,
  leaseMs: number,
) {
  const rt = createClockRuntime({
    instanceId,
    store,
    leaseMs: Number.isFinite(leaseMs) ? leaseMs : 100,
  });
  rt.register(clock(CRON_NAME, { every: "50ms" }));
  await rt.reconcile();

  rt.onCron(CRON_NAME, () => {});
  const ok = await rt.runNow(CRON_NAME);
  if (!ok) {
    console.error("hold-lease: failed to acquire/fire");
    process.exit(3);
  }
  const row = await store.get(CRON_NAME);
  await Bun.write(
    markerPath,
    JSON.stringify({
      instanceId,
      heldAt: Date.now(),
      leaderLeaseUntil: row?.leaderLeaseUntil,
    }),
  );
  await Bun.sleep(60_000);
  process.exit(0);
}

if (mode === "tick-loop") {
  const storePath = process.argv[3];
  const instanceId = process.argv[4];
  const fireLogPath = process.argv[5];
  const leaseMs = Number(process.argv[6] ?? 100);
  const every = process.argv[7] ?? "1h";
  if (!storePath || !instanceId || !fireLogPath) {
    console.error(
      "usage: chaos-child tick-loop <storePath> <instanceId> <fireLogPath> <leaseMs> [every]",
    );
    process.exit(2);
  }
  await runTickLoop(createFileCronStore(join(storePath)), instanceId, fireLogPath, leaseMs, every);
} else if (mode === "hold-lease") {
  const storePath = process.argv[3];
  const instanceId = process.argv[4];
  const markerPath = process.argv[5];
  const leaseMs = Number(process.argv[6] ?? 100);
  if (!storePath || !instanceId || !markerPath) {
    console.error("usage: chaos-child hold-lease <storePath> <instanceId> <markerPath> <leaseMs>");
    process.exit(2);
  }
  await runHoldLease(createFileCronStore(join(storePath)), instanceId, markerPath, leaseMs);
} else if (mode === "tick-loop-pg") {
  const databaseUrl = process.argv[3];
  const instanceId = process.argv[4];
  const fireLogPath = process.argv[5];
  const leaseMs = Number(process.argv[6] ?? 100);
  const every = process.argv[7] ?? "1h";
  if (!databaseUrl || !instanceId || !fireLogPath) {
    console.error(
      "usage: chaos-child tick-loop-pg <databaseUrl> <instanceId> <fireLogPath> <leaseMs> [every]",
    );
    process.exit(2);
  }
  const store = await createPostgresCronStore({ url: databaseUrl });
  await runTickLoop(store, instanceId, fireLogPath, leaseMs, every);
} else if (mode === "hold-lease-pg") {
  const databaseUrl = process.argv[3];
  const instanceId = process.argv[4];
  const markerPath = process.argv[5];
  const leaseMs = Number(process.argv[6] ?? 100);
  if (!databaseUrl || !instanceId || !markerPath) {
    console.error(
      "usage: chaos-child hold-lease-pg <databaseUrl> <instanceId> <markerPath> <leaseMs>",
    );
    process.exit(2);
  }
  const store = await createPostgresCronStore({ url: databaseUrl });
  await runHoldLease(store, instanceId, markerPath, leaseMs);
} else if (mode === "durable-mid-step") {
  const journalPath = process.argv[3];
  const markerPath = process.argv[4];
  const runIdPath = process.argv[5];
  if (!journalPath || !markerPath || !runIdPath) {
    console.error("usage: chaos-child durable-mid-step <journalPath> <markerPath> <runIdPath>");
    process.exit(2);
  }

  const journalStore = createFileJournalStore(join(journalPath));
  const charge = flow("chaos.charge", {
    durable: true,
    do: async (_input, fx) => {
      const intent = await fx.step("create-intent", async () => {
        const runs = await journalStore.list();
        const run = runs[0];
        if (run) await Bun.write(runIdPath, run.id);
        await Bun.write(markerPath, "step1");
        return { id: "pi_chaos" };
      });
      await Bun.sleep(60_000);
      return fx.step("confirm", () => intent.id === "pi_chaos");
    },
  });

  await runDurable({
    flow: charge,
    input: { orderId: "o-chaos" },
    journalStore,
  });
  process.exit(0);
} else if (mode === "journal-pg-start") {
  const [databaseUrl, instanceId, stepLogPath, markerPath] = process.argv.slice(3);
  const leaseMs = Number(process.argv[7] ?? 300);
  const blockMs = Number(process.argv[8] ?? 60_000);
  if (!databaseUrl || !instanceId || !stepLogPath || !markerPath) {
    console.error(
      "usage: chaos-child journal-pg-start <databaseUrl> <instanceId> <stepLogPath> <markerPath> <leaseMs> <blockMs>",
    );
    process.exit(2);
  }
  const app = await bootJournalPgApp({
    url: databaseUrl!,
    instanceId: instanceId!,
    leaseMs,
    flow: chargeFlow(instanceId!, stepLogPath!, blockMs),
  });
  void app.fetch(new Request("http://localhost/charge", { method: "POST", body: "{}" }));
  // Marker once step 1 is journaled — then hang; the parent SIGKILLs mid-run.
  const deadline = Date.now() + 15_000;
  for (;;) {
    const row = (await app.bootResult!.journal!.store.list())[0];
    if (row && row.entries.length >= 1) {
      await Bun.write(markerPath!, JSON.stringify({ runId: row.id, instanceId }));
      break;
    }
    if (Date.now() > deadline) {
      console.error("journal-pg-start: step 1 never journaled");
      process.exit(3);
    }
    await Bun.sleep(10);
  }
  await Bun.sleep(3_600_000);
  process.exit(0);
} else if (mode === "journal-pg-resume") {
  const [databaseUrl, instanceId, stepLogPath, donePath] = process.argv.slice(3);
  const leaseMs = Number(process.argv[7] ?? 300);
  if (!databaseUrl || !instanceId || !stepLogPath || !donePath) {
    console.error(
      "usage: chaos-child journal-pg-resume <databaseUrl> <instanceId> <stepLogPath> <donePath> <leaseMs>",
    );
    process.exit(2);
  }
  // No fetch — the boot orphan scan / resume sweep must discover the dead run.
  const app = await bootJournalPgApp({
    url: databaseUrl!,
    instanceId: instanceId!,
    leaseMs,
    flow: chargeFlow(instanceId!, stepLogPath!, 0),
  });
  const deadline = Date.now() + 20_000;
  for (;;) {
    await app.resumeDurable();
    const row = (await app.bootResult!.journal!.store.list())[0];
    if (row?.status === "completed") {
      await Bun.write(donePath!, JSON.stringify({ runId: row.id, completedBy: instanceId }));
      process.exit(0);
    }
    if (Date.now() > deadline) {
      console.error("journal-pg-resume: orphan never resumed");
      process.exit(3);
    }
    await Bun.sleep(25);
  }
} else if (mode === "journal-pg-park") {
  const [databaseUrl, instanceId, stepLogPath, parkedPath] = process.argv.slice(3);
  const wakeMs = Number(process.argv[7] ?? 400);
  if (!databaseUrl || !instanceId || !stepLogPath || !parkedPath) {
    console.error(
      "usage: chaos-child journal-pg-park <databaseUrl> <instanceId> <stepLogPath> <parkedPath> <wakeMs>",
    );
    process.exit(2);
  }
  const app = await bootJournalPgApp({
    url: databaseUrl!,
    instanceId: instanceId!,
    leaseMs: 30_000,
    flow: sleeperFlow(instanceId!, stepLogPath!, wakeMs),
  });
  const res = await app.fetch(
    new Request("http://localhost/sleep", { method: "POST", body: "{}" }),
  );
  if (res.status !== 204) {
    console.error(`journal-pg-park: expected 204 park, got ${res.status}`);
    process.exit(3);
  }
  const row = (await app.bootResult!.journal!.store.list())[0];
  await Bun.write(parkedPath!, JSON.stringify({ runId: row?.id, instanceId }));
  process.exit(0);
} else if (mode === "journal-pg-claim") {
  const [databaseUrl, instanceId, stepLogPath] = process.argv.slice(3);
  const leaseMs = Number(process.argv[6] ?? 300);
  if (!databaseUrl || !instanceId || !stepLogPath) {
    console.error(
      "usage: chaos-child journal-pg-claim <databaseUrl> <instanceId> <stepLogPath> <leaseMs>",
    );
    process.exit(2);
  }
  const app = await bootJournalPgApp({
    url: databaseUrl!,
    instanceId: instanceId!,
    leaseMs,
    flow: sleeperFlow(instanceId!, stepLogPath!, 400),
  });
  const deadline = Date.now() + 15_000;
  for (;;) {
    await app.resumeDurable();
    if (await logHasStep(stepLogPath!, "confirm", instanceId!)) process.exit(0);
    const row = (await app.bootResult!.journal!.store.list())[0];
    if (row?.status === "completed") process.exit(3); // someone else claimed it
    if (Date.now() > deadline) process.exit(3);
    await Bun.sleep(25);
  }
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}

/** Append one JSON line to the shared step log. */
async function appendStepLog(
  path: string,
  entry: { instanceId: string; step: string; at: number },
): Promise<void> {
  const prev = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  await Bun.write(path, `${prev}${JSON.stringify(entry)}\n`);
}

/** True when the step log holds `step` executed by `instanceId`. */
async function logHasStep(path: string, step: string, instanceId: string): Promise<boolean> {
  if (!(await Bun.file(path).exists())) return false;
  const lines = (await Bun.file(path).text()).trim().split("\n").filter(Boolean);
  return lines.some((l) => {
    const e = JSON.parse(l) as { instanceId: string; step: string };
    return e.step === step && e.instanceId === instanceId;
  });
}

/** Durable charge flow: step 1 → block → step 2 (both logged). */
function chargeFlow(instanceId: string, stepLogPath: string, blockMs: number): AnyFlowDef {
  return flow("chaos.journal.charge", {
    durable: true,
    do: async (_input, fx) => {
      const intent = await fx.step("create-intent", async () => {
        await appendStepLog(stepLogPath, { instanceId, step: "create-intent", at: Date.now() });
        return { id: "pi_chaos" };
      });
      if (blockMs > 0) await Bun.sleep(blockMs);
      await fx.step("mid-flight", async () => {
        await appendStepLog(stepLogPath, { instanceId, step: "mid-flight", at: Date.now() });
        return intent.id === "pi_chaos";
      });
      return { ok: true };
    },
  });
}

/** Durable sleeper flow: step 1 → sleep → confirm (steps logged). */
function sleeperFlow(instanceId: string, stepLogPath: string, wakeMs: number): AnyFlowDef {
  return flow("chaos.journal.sleeper", {
    durable: true,
    do: async (_input, fx) => {
      await fx.step("create-intent", async () => {
        await appendStepLog(stepLogPath, { instanceId, step: "create-intent", at: Date.now() });
        return { id: "pi_chaos" };
      });
      await fx.clock.sleep("verify-window", `${wakeMs}ms`);
      await fx.step("confirm", async () => {
        await appendStepLog(stepLogPath, { instanceId, step: "confirm", at: Date.now() });
        return true;
      });
      return { ok: true };
    },
  });
}

/** Boot a real `oke()` app against live postgres (drivers.journal). */
async function bootJournalPgApp(options: {
  readonly url: string;
  readonly instanceId: string;
  readonly leaseMs: number;
  readonly flow: AnyFlowDef;
}): Promise<OkeApp> {
  process.env.DATABASE_URL = options.url;
  on(http.post("/charge"), options.flow);
  on(http.post("/sleep"), options.flow);
  const app = oke({
    name: `chaos-journal-${options.instanceId}`,
    env: "test",
    startScheduler: false,
    gate: { unguardedHttp: "allow" },
    config: { drivers: { journal: { test: "postgres" } } },
  });
  await app.boot({ instanceId: options.instanceId, journalLeaseMs: options.leaseMs });
  return app;
}
