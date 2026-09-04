/**
 * Horizontal multi-instance child — one real app process for the
 * `horizontal.integration.test.ts` suite.
 *
 * Args:
 *   serve <instanceId> <port> <pgUrl> <redisUrl> <signalPath> <workDir> <leaseMs>
 *
 * HTTP:
 *   GET  /_/ready
 *   GET  /ping
 *   GET  /rate          — Gate rate-limited (max 5 / 1m, keyBy ip)
 *   POST /write         — Store SQL insert into oke_horizontal_writes
 *   POST /emit          — Signal once emit
 *   POST /charge        — Durable flow; hangs in step 2 until marker + SIGKILL
 */

import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

import { createPostgresCronStore } from "../drivers/clock-postgres.ts";
import { createPostgresJournalStore } from "../drivers/journal-postgres.ts";
import { memorySignalDriver } from "../drivers/signal-memory.ts";
import { postgresDriver } from "../drivers/postgres.ts";
import { redisDriver } from "../drivers/redis.ts";
import { clock } from "../elements/clock/declare.ts";
import { createClockRuntime } from "../elements/clock/runtime.ts";
import { gate } from "../elements/gate.ts";
import { createGateRuntime } from "../elements/gate/runtime.ts";
import { signal } from "../elements/signal/declare.ts";
import { createSignalRuntime } from "../elements/signal/runtime.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import { sql } from "../elements/store/declare.ts";
import { defineTable } from "../elements/store/table.ts";
import { oke } from "./app.ts";
import { flow, type AnyFlowDef } from "./flow.ts";
import type { Binding } from "./on.ts";
import { http } from "./triggers.ts";
import { GATE_KV_NAMESPACE } from "./boot-bind/gate.ts";
import { createBunRuntime } from "../runtime/bun.ts";
import { installGracefulShutdown } from "./graceful-shutdown.ts";
import { okid } from "../okid.ts";

const mode = process.argv[2];
if (mode !== "serve") {
  console.error(
    "usage: horizontal-child serve <instanceId> <port> <pgUrl> <redisUrl> <signalPath> <workDir> <leaseMs>",
  );
  process.exit(2);
}

const instanceId = process.argv[3]!;
const port = Number(process.argv[4]);
const pgUrl = process.argv[5]!;
const redisUrl = process.argv[6]!;
const signalPath = process.argv[7]!;
const workDir = process.argv[8]!;
const leaseMs = Number(process.argv[9] ?? "300");

mkdirSync(workDir, { recursive: true });
mkdirSync(dirname(signalPath), { recursive: true });

const CRON = "horizontal-cron";
const SIG = "horizontal-job";
const rateGate = gate.rate({
  max: 5,
  per: "1m",
  keyBy: "ip",
  description: "horizontal rate",
});

const db = sql("db");
const writesTable = defineTable("oke_horizontal_writes", {
  id: true,
  instance_id: true,
  at: true,
});

const cronStore = await createPostgresCronStore({ url: pgUrl });
const journalStore = await createPostgresJournalStore({ url: pgUrl });
await journalStore.sql.exec(`
  CREATE TABLE IF NOT EXISTS oke_horizontal_writes (
    id TEXT PRIMARY KEY,
    instance_id TEXT NOT NULL,
    at BIGINT NOT NULL
  )
`);

const clockRt = createClockRuntime({
  store: cronStore,
  instanceId,
  leaseMs: Number.isFinite(leaseMs) ? leaseMs : 300,
});
clockRt.register(clock(CRON, { every: "1h" }));
await clockRt.reconcile();
clockRt.onCron(CRON, async () => {
  const line = `${JSON.stringify({ instanceId, kind: "cron", at: Date.now() })}\n`;
  const path = join(workDir, "cron.jsonl");
  const prev = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  await Bun.write(path, prev + line);
});

const signalRt = createSignalRuntime({
  driver: memorySignalDriver,
  durablePath: signalPath,
  leaseMs: Number.isFinite(leaseMs) ? leaseMs : 300,
});
const job = signal.once(SIG, { retries: 3, deadLetter: true, optional: true });
signalRt.register(job);
const bus = await signalRt.start();
await bus.subscribe(SIG, `consumer-${instanceId}`, async (msg) => {
  const line = `${JSON.stringify({ instanceId, kind: "signal", id: msg.id, at: Date.now() })}\n`;
  const path = join(workDir, "signal.jsonl");
  const prev = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
  await Bun.write(path, prev + line);
});

const kv = await redisDriver.open({
  name: GATE_KV_NAMESPACE,
  url: redisUrl,
  nowMs: () => Date.now(),
});
const gateRt = createGateRuntime({
  gates: [rateGate, gate.public],
  kv,
  now: () => Date.now(),
});

const storeRt = createStoreRuntime({
  drivers: { sql: postgresDriver },
  sql: { db: { name: "db", primary: { url: pgUrl } } },
  now: () => Date.now(),
});
storeRt.register(db);

const ping = flow("horizontal.ping", {
  do: () => ({ ok: true as const, instanceId }),
});
const rate = flow("horizontal.rate", {
  do: () => ({ ok: true as const, instanceId }),
});
const write = flow("horizontal.write", {
  do: async (_input, fx) => {
    const id = okid();
    await fx
      .store(db)
      .insert(writesTable)
      .values({ id, instance_id: instanceId, at: Date.now() })
      .execute();
    const line = `${JSON.stringify({ instanceId, kind: "write", id, at: Date.now() })}\n`;
    const path = join(workDir, "writes.jsonl");
    const prev = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
    await Bun.write(path, prev + line);
    return { id };
  },
});
const emit = flow("horizontal.emit", {
  do: async (_input, fx) => {
    await fx.emit(SIG, { from: instanceId, at: Date.now() });
    return { emitted: true as const };
  },
});
const charge = flow("horizontal.charge", {
  durable: true,
  do: async (_input, fx) => {
    await fx.step("create-intent", async () => {
      const line = `${JSON.stringify({ instanceId, step: "create-intent", at: Date.now() })}\n`;
      const path = join(workDir, "steps.jsonl");
      const prev = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
      await Bun.write(path, prev + line);
      return { id: "pi_h" };
    });
    await fx.step("mid-flight", async () => {
      await Bun.write(join(workDir, `hang-${instanceId}.json`), JSON.stringify({ hung: true }));
      // Parent writes allow-complete.json after SIGKILL so the survivor finishes.
      const allow = join(workDir, "allow-complete.json");
      const deadline = Date.now() + 45_000;
      while (!(await Bun.file(allow).exists()) && Date.now() < deadline) {
        await Bun.sleep(20);
      }
      if (!(await Bun.file(allow).exists())) {
        throw new Error("horizontal.charge: timed out waiting for allow-complete");
      }
      const line = `${JSON.stringify({ instanceId, step: "mid-flight", at: Date.now() })}\n`;
      const path = join(workDir, "steps.jsonl");
      const prev = (await Bun.file(path).exists()) ? await Bun.file(path).text() : "";
      await Bun.write(path, prev + line);
      return "done";
    });
    return { ok: true as const };
  },
});

const bindings: Binding[] = [
  { trigger: http.get("/ping").public(), flow: ping as AnyFlowDef },
  { trigger: http.get("/rate").gate(rateGate), flow: rate as AnyFlowDef },
  { trigger: http.post("/write").public(), flow: write as AnyFlowDef },
  { trigger: http.post("/emit").public(), flow: emit as AnyFlowDef },
  { trigger: http.post("/charge").public(), flow: charge as AnyFlowDef },
];

const app = oke({
  name: `horizontal-${instanceId}`,
  env: "test",
  startScheduler: false,
  gate: { unguardedHttp: "allow", policies: [rateGate, gate.public] },
  journalLeaseMs: Number.isFinite(leaseMs) ? leaseMs : 300,
  bindings,
  clocks: [clock(CRON, { every: "1h" })],
  signals: [job],
  stores: [db],
  elements: {
    clock: clockRt,
    signal: signalRt,
    gate: gateRt,
    store: storeRt,
    journal: {
      store: journalStore,
      instanceId,
      leaseMs: Number.isFinite(leaseMs) ? leaseMs : 300,
      driverId: "postgres",
    },
  },
});

await app.boot();

// Background: clock ticks + signal drain (concurrent with HTTP).
void (async () => {
  for (;;) {
    try {
      await clockRt.tick();
      await bus.drain();
      await app.resumeDurable();
    } catch (err) {
      console.error("horizontal-child tick error", err);
    }
    await Bun.sleep(20);
  }
})();

const handle = createBunRuntime().serve(app, {
  port,
  hostname: "127.0.0.1",
});
installGracefulShutdown({ app, handle, exit: true });

await Bun.write(
  join(workDir, `ready-${instanceId}.json`),
  JSON.stringify({ port: handle.port, instanceId }),
);

// Keep alive
await new Promise(() => {});
