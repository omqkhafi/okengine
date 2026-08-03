/**
 * Clock chaos child — multi-process leader election / durable resume.
 *
 * Args:
 *   tick-loop <storePath> <instanceId> <fireLogPath> <leaseMs> [every]
 *   hold-lease <storePath> <instanceId> <markerPath> <leaseMs>
 *   tick-loop-pg <databaseUrl> <instanceId> <fireLogPath> <leaseMs> [every]
 *   hold-lease-pg <databaseUrl> <instanceId> <markerPath> <leaseMs>
 *   durable-mid-step <journalPath> <markerPath> <runIdPath>
 *
 * Modes:
 *   tick-loop / tick-loop-pg   — reconcile + tick until this instance fires once
 *   hold-lease / hold-lease-pg — acquire lease, write marker, hang (parent SIGKILLs)
 *   durable-mid-step           — journal step 1, write marker + runId, hang
 */

import { join } from "node:path";

import { createPostgresCronStore } from "../../drivers/clock-postgres.ts";
import { flow } from "../../kernel/flow.ts";
import { createFileJournalStore } from "../../kernel/journal.ts";
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
  const charge = flow({
    name: "chaos.charge",
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
} else {
  console.error(`unknown mode: ${mode}`);
  process.exit(2);
}
