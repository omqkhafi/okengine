/**
 * Clock chaos child — multi-process leader election / durable resume.
 *
 * Args:
 *   tick-loop <storePath> <instanceId> <fireLogPath> <leaseMs> [every]
 *   hold-lease <storePath> <instanceId> <markerPath> <leaseMs>
 *   durable-mid-step <journalPath> <markerPath> <runIdPath>
 *
 * Modes:
 *   tick-loop         — reconcile + tick until this instance fires once, append fire log
 *   hold-lease        — acquire lease, write marker, hang (parent SIGKILLs)
 *   durable-mid-step  — journal step 1, write marker + runId, hang (parent SIGKILLs)
 */

import { join } from "node:path";

import { flow } from "../../kernel/flow.ts";
import { createFileJournalStore } from "../../kernel/journal.ts";
import { clock } from "./declare.ts";
import { runDurable } from "./durable.ts";
import { createFileCronStore } from "./reconcile.ts";
import { createClockRuntime } from "./runtime.ts";

const mode = process.argv[2];

if (!mode) {
  console.error("usage: chaos-child <tick-loop|hold-lease|durable-mid-step> …");
  process.exit(2);
}

const CRON_NAME = "chaos-job";

if (mode === "tick-loop") {
  const storePath = process.argv[3];
  const instanceId = process.argv[4];
  const fireLogPath = process.argv[5];
  const leaseMs = Number(process.argv[6] ?? 100);
  // Default 1h so a second process cannot become due again within the test window
  // after the winner sets lastRunAt (proves one fire per tick, not one per lease).
  const every = process.argv[7] ?? "1h";
  if (!storePath || !instanceId || !fireLogPath) {
    console.error(
      "usage: chaos-child tick-loop <storePath> <instanceId> <fireLogPath> <leaseMs> [every]",
    );
    process.exit(2);
  }

  const store = createFileCronStore(join(storePath));
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

if (mode === "hold-lease") {
  const storePath = process.argv[3];
  const instanceId = process.argv[4];
  const markerPath = process.argv[5];
  const leaseMs = Number(process.argv[6] ?? 100);
  if (!storePath || !instanceId || !markerPath) {
    console.error("usage: chaos-child hold-lease <storePath> <instanceId> <markerPath> <leaseMs>");
    process.exit(2);
  }

  const store = createFileCronStore(join(storePath));
  const rt = createClockRuntime({
    instanceId,
    store,
    leaseMs: Number.isFinite(leaseMs) ? leaseMs : 100,
  });
  rt.register(clock(CRON_NAME, { every: "50ms" }));
  await rt.reconcile();

  // Fire once so lastRunAt + lease are set (this instance is leader).
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
  // Hang while holding the lease — parent will SIGKILL.
  await Bun.sleep(60_000);
  process.exit(0);
}

if (mode === "durable-mid-step") {
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
        // Persist run id as soon as the step body runs (session already started).
        const runs = await journalStore.list();
        const run = runs[0];
        if (run) await Bun.write(runIdPath, run.id);
        await Bun.write(markerPath, "step1");
        return { id: "pi_chaos" };
      });
      // Hang after journaling step 1 — parent SIGKILLs before confirm.
      await Bun.sleep(60_000);
      return fx.step("confirm", () => intent.id === "pi_chaos");
    },
  });

  await runDurable({
    flow: charge,
    input: { orderId: "o-chaos" },
    journalStore,
  });
  // Unreachable under SIGKILL.
  process.exit(0);
}

console.error(`unknown mode: ${mode}`);
process.exit(2);
