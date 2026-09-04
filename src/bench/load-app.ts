/**
 * Bench load app — one real app process exposing every bench route needed
 * by G1–G15. Modeled on `src/kernel/horizontal-child.ts`.
 *
 * Env (resolved at runtime, never printed):
 *   DATABASE_URL / OKE_STORE_SQL_URL — live Postgres via pgdog
 *   OKE_TEST_REDIS_URL or REDIS_URL  — live Redis
 *   OKE_BENCH_MAILPIT_HOST / _PORT   — Mailpit for channel bulk (default 127.0.0.1:1025)
 *
 * Routes:
 *   GET  /_/ready              { ok, pid }
 *   GET  /_/stats              uptime, rss, counters
 *   GET  /ping                 plain public flow
 *   GET  /rate                 gate.rate-limited (keyBy ip)
 *   POST /_/bench/rls          mixed-identity store writes through shared conn
 *   POST /_/bench/rate         gate.rate-limited POST variant
 *   POST /_/bench/emit         signal once emit
 *   POST /_/bench/drain        signal bus drain
 *   GET  /_oke/live/bench-live live SSE delivery (auto route via http.live)
 *   POST /_/bench/durable      durable flow with fx.step
 *   POST /_/bench/vault-read   vault runtime read
 *   POST /_/bench/stream       fx.json.stream SSE response
 *   POST /_/bench/channel-bulk channel RetryTransport bulk send → Mailpit
 */

import { openSmtpChannel } from "../drivers/channel-smtp.ts";
import { createPostgresCronStore } from "../drivers/clock-postgres.ts";
import { createPostgresJournalStore } from "../drivers/journal-postgres.ts";
import { memorySignalDriver } from "../drivers/signal-memory.ts";
import { postgresDriver } from "../drivers/postgres.ts";
import { redisDriver } from "../drivers/redis.ts";
import { channel } from "../elements/channel.ts";
import { createChannelRuntime, type TemplateCatalog } from "../elements/channel/runtime.ts";
import { clock } from "../elements/clock/declare.ts";
import { createClockRuntime } from "../elements/clock/runtime.ts";
import { gate } from "../elements/gate.ts";
import { createGateRuntime } from "../elements/gate/runtime.ts";
import { signal } from "../elements/signal/declare.ts";
import { createSignalRuntime } from "../elements/signal/runtime.ts";
import { sql } from "../elements/store/declare.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import { defineTable } from "../elements/store/table.ts";
import { vault } from "../elements/vault/declare.ts";
import { createVaultRuntime } from "../elements/vault/runtime.ts";
import { GATE_KV_NAMESPACE } from "../kernel/boot-bind/gate.ts";
import { oke } from "../kernel/app.ts";
import { flow, type AnyFlowDef } from "../kernel/flow.ts";
import type { Binding } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { installGracefulShutdown } from "../kernel/graceful-shutdown.ts";
import { okid } from "../okid.ts";
import { createBunRuntime } from "../runtime/bun.ts";

const mode = process.argv[2];
if (mode !== "serve") {
  console.error("usage: load-app serve <instanceId> <port>");
  process.exit(2);
}

const instanceId = process.argv[3] ?? "bench-a";
const port = Number(process.argv[4] ?? "0");

const pgUrl = process.env.DATABASE_URL?.trim() || process.env.OKE_STORE_SQL_URL?.trim() || "";
const redisUrl = (process.env.OKE_TEST_REDIS_URL ?? process.env.REDIS_URL)?.trim() ?? "";
if (!pgUrl || !redisUrl) {
  console.error("load-app: DATABASE_URL and OKE_TEST_REDIS_URL (or REDIS_URL) are required");
  process.exit(2);
}

const t0 = Date.now();
const counters = { rls: 0, emits: 0, drains: 0, durable: 0, vaultReads: 0, streams: 0, mails: 0 };

// --- Clock (perTenant cron declared for G2/G6) ------------------------------
const cronStore = await createPostgresCronStore({ url: pgUrl });
const CRON = "bench-cron";
const benchClock = clock(CRON, { every: "1h", perTenant: true });
const clockRt = createClockRuntime({ store: cronStore, instanceId, leaseMs: 300 });
clockRt.register(benchClock);
await clockRt.reconcile();
clockRt.onCron(CRON, async () => {});

// --- Signal (once + live physics) -------------------------------------------
const signalPath = `/tmp/oke-bench-signal-${process.pid}.json`;
const BENCH_JOB = signal.once("bench-job", { retries: 3,
  deadLetter: true,
  optional: true });
const BENCH_LIVE = signal.live("bench-live", { retention: { maxCount: 100 } });
const signalRt = createSignalRuntime({
  driver: memorySignalDriver,
  durablePath: signalPath,
  leaseMs: 300,
});
signalRt.register(BENCH_JOB as never);
signalRt.register(BENCH_LIVE as never);
const bus = await signalRt.start();
await bus.subscribe(BENCH_JOB.name, `consumer-${instanceId}`, async () => {});

// --- Gate --------------------------------------------------------------------
const rateGate = gate.rate({ max: 1000, per: "1m", keyBy: "ip" });
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

// --- Store -------------------------------------------------------------------
const db = sql("db");
const benchTable = defineTable("oke_bench_rows", {
  id: true,
  tenant_id: true,
  instance_id: true,
  at: true,
});
const journalStore = await createPostgresJournalStore({ url: pgUrl });
await journalStore.sql.exec(`
  CREATE TABLE IF NOT EXISTS oke_bench_rows (
    id TEXT PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    instance_id TEXT NOT NULL,
    at BIGINT NOT NULL
  )
`);
const storeRt = createStoreRuntime({
  drivers: { sql: postgresDriver },
  sql: { db: { name: "db", primary: { url: pgUrl } } },
  now: () => Date.now(),
});
storeRt.register(db);

// --- Vault -------------------------------------------------------------------
const VAULT_SECRET = "OKE_BENCH_SECRET";
const vaultRt = createVaultRuntime({
  secrets: [vault.config(VAULT_SECRET, { dev: "bench-value" })],
  allowDevFallbacks: true,
});
await vaultRt.boot();

// --- Channel (Mailpit SMTP + RetryTransport) ----------------------------------
const mailHost = process.env.OKE_BENCH_MAILPIT_HOST?.trim() || "127.0.0.1";
const mailPort = Number(process.env.OKE_BENCH_MAILPIT_PORT ?? "1025");
const WELCOME = channel.email().template("bench-welcome");
const catalog: TemplateCatalog = {
  "bench-welcome": { en: { subject: "Bench welcome", text: "Hello bench" } },
};
let channelRt: ReturnType<typeof createChannelRuntime> | undefined;
try {
  channelRt = createChannelRuntime({
    templates: [WELCOME],
    drivers: [openSmtpChannel({ host: mailHost, port: mailPort })],
    catalog,
    retry: true,
    now: () => Date.now(),
  });
} catch (err) {
  console.error("load-app: channel disabled", err);
}

// --- Flows ---------------------------------------------------------------------
const ping = flow("bench.ping", { do: () => ({ ok: true as const }) });

const statsFlow = flow("bench.stats", { do: () => benchStats() });

const liveFirehose = flow("bench.live-firehose", {
  do: (_input, fx) => fx.live(BENCH_LIVE),
});

const rlsWrite = flow("bench.rls", {
  do: async (input, fx) => {
    const body = input as { tenantId?: string; n?: number };
    const n = Math.max(1, Math.min(64, Number(body.n ?? 1)));
    for (let i = 0; i < n; i++) {
      await fx
        .store(db)
        .insert(benchTable)
        .values({
          id: okid(),
          tenant_id: body.tenantId ?? `tenant-${i}`,
          instance_id: instanceId,
          at: Date.now(),
        })
        .execute();
    }
    counters.rls += n;
    return { written: n };
  },
});

const rateFlow = flow("bench.rate", { do: () => ({ ok: true as const }) });

const emit = flow("bench.emit", {
  do: async (_input, fx) => {
    await fx.emit(BENCH_JOB, { from: instanceId, at: Date.now() });
    counters.emits++;
    return { emitted: true as const };
  },
});

const emitLive = flow("bench.emit-live", {
  do: async (_input, fx) => {
    await fx.emit(BENCH_LIVE, { from: instanceId, at: Date.now() });
    counters.emits++;
    return { emitted: true as const };
  },
});

const drainFlow = flow("bench.drain", {
  do: async () => {
    await bus.drain();
    counters.drains++;
    return { drained: true as const };
  },
});

const durableFlow = flow("bench.durable", {
  durable: true,
  do: async (_input, fx) => {
    await fx.step("step-one", async () => ({ at: Date.now() }));
    await fx.step("step-two", async () => "done");
    counters.durable++;
    return { ok: true as const };
  },
});

const vaultRead = flow("bench.vault-read", {
  do: async (_input, fx) => {
    const value = await fx.vault.get(VAULT_SECRET);
    counters.vaultReads++;
    return { len: String(value).length };
  },
});

const streamN = flow("bench.stream", {
  do: async (input, fx) => {
    const chunks = Number((input as { chunks?: number }).chunks ?? 16);
    counters.streams++;
    return fx.json.stream(
      (async function* () {
        for (let i = 0; i < chunks; i++) yield { i, at: Date.now() };
      })(),
    );
  },
});

const channelBulk = flow("bench.channel-bulk", {
  do: async (input) => {
    if (!channelRt) throw new Error("channel runtime unavailable (Mailpit down?)");
    const count = Math.max(1, Math.min(500, Number((input as { count?: number }).count ?? 10)));
    let sent = 0;
    for (let i = 0; i < count; i++) {
      const r = await channelRt.send(WELCOME.name, {
        to: `bench-${okid()}@example.test`,
        data: { i },
      });
      if (r.ok) sent++;
    }
    counters.mails += sent;
    return { sent };
  },
});

const bindings: Binding[] = [
  { trigger: http.get("/ping").public(), flow: ping as AnyFlowDef },
  { trigger: http.get("/_/stats").public(), flow: statsFlow as AnyFlowDef },
  { trigger: http.get("/rate").gate(rateGate), flow: rateFlow as AnyFlowDef },
  { trigger: http.post("/_/bench/rate").gate(rateGate), flow: rateFlow as AnyFlowDef },
  { trigger: http.post("/_/bench/rls").public(), flow: rlsWrite as AnyFlowDef },
  { trigger: http.post("/_/bench/emit").public(), flow: emit as AnyFlowDef },
  { trigger: http.post("/_/bench/emit-live").public(), flow: emitLive as AnyFlowDef },
  { trigger: http.post("/_/bench/drain").public(), flow: drainFlow as AnyFlowDef },
  { trigger: http.live(BENCH_LIVE).public(), flow: liveFirehose as AnyFlowDef },
  { trigger: http.post("/_/bench/durable").public(), flow: durableFlow as AnyFlowDef },
  { trigger: http.post("/_/bench/vault-read").public(), flow: vaultRead as AnyFlowDef },
  { trigger: http.post("/_/bench/stream").public(), flow: streamN as AnyFlowDef },
  { trigger: http.post("/_/bench/channel-bulk").public(), flow: channelBulk as AnyFlowDef },
];

const app = oke({
  name: `bench-load-${instanceId}`,
  env: "test",
  startScheduler: false,
  gate: { unguardedHttp: "allow", policies: [rateGate, gate.public] },
  journalLeaseMs: 300,
  bindings,
  clocks: [benchClock],
  signals: [BENCH_JOB as never, BENCH_LIVE as never],
  stores: [db],
  elements: {
    clock: clockRt,
    signal: signalRt,
    gate: gateRt,
    store: storeRt,
    journal: { store: journalStore, instanceId, leaseMs: 300, driverId: "postgres" },
  },
});

await app.boot();

void (async () => {
  for (;;) {
    try {
      await clockRt.tick();
      await bus.drain();
      await app.resumeDurable();
    } catch (err) {
      console.error("load-app tick error", err);
    }
    await Bun.sleep(20);
  }
})();

const handle = createBunRuntime().serve(app, { port, hostname: "127.0.0.1" });
installGracefulShutdown({ app, handle, exit: true });

export function benchStats(): Record<string, unknown> {
  return {
    pid: process.pid,
    uptimeS: Math.round((Date.now() - t0) / 1000),
    rssMb: Math.round(process.memoryUsage.rss() / 1024 / 1024),
    counters,
  };
}

console.log(JSON.stringify({ ready: true, pid: process.pid, port: handle.port, instanceId }));

// Keep alive
await new Promise(() => {});
