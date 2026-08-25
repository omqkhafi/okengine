/**
 * G10 — observability contention: same load twice, app alone vs app +
 * Console signals-panel queries (`projectSignalsList`,
 * `src/console/server/signals.ts`) hammering the same Postgres pool.
 *
 * Each arm boots a fresh `load-child serve` and runs an identical G5-shaped
 * closed-loop (30× /ping + 10× durable journal flow + 10× store insert) for
 * `OKE_BENCH_G10_ARM_S` seconds. Arm B adds 3 concurrent
 * `projectSignalsList()` loops whose `bus.inspect()` COUNT queries run on the
 * same DATABASE_URL pool. Metric: req/sec delta between arms.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… OKE_TEST_REDIS_URL=… bun test ./src/bench/g10-observability-contention.bench.ts --timeout 600000
 */

import { describe, expect, test } from "bun:test";
import { openPostgresSignal } from "../drivers/signal-postgres.ts";
import type { SignalBus } from "../drivers/signal-types.ts";
import { createMemorySignalConfigStore } from "../elements/signal/reconcile.ts";
import { signal } from "../elements/signal/declare.ts";
import { projectSignalsList } from "../console/server/signals.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { createBunSignalSql } from "./lib/signal-pg.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const ARM_S = CAL ? 15 : Math.max(30, Number(process.env.OKE_BENCH_G10_ARM_S ?? "120"));
const PING_WORKERS = 30;
const DURABLE_WORKERS = 10;
const STORE_WORKERS = 10;
const OBSERVER_LOOPS = 3;

type Server = Bun.Subprocess<"ignore", "pipe", "ignore">;

function spawnServe(port: number): Server {
  return Bun.spawn(["bun", "run", "src/bench/load-child.ts", "serve", String(port)], {
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  });
}

async function readReadyPid(proc: Server): Promise<number> {
  const reader = proc.stdout.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) throw new Error("server died before ready");
    buf += dec.decode(value, { stream: true });
    const nl = buf.indexOf("\n");
    if (nl >= 0) {
      const line = buf.slice(0, nl).trim();
      if (line.startsWith("{")) {
        void (async () => {
          try {
            for (;;) {
              const r = await reader.read();
              if (r.done) break;
            }
          } catch {
            /* closed */
          }
        })();
        return (JSON.parse(line) as { pid: number }).pid;
      }
    }
  }
}

/** One arm: identical closed-loop shape; optional concurrent console queries. */
async function runArm(
  port: number,
  observers: boolean,
  sql: ReturnType<typeof createBunSignalSql> | null,
): Promise<{
  pingRps: number;
  durableRps: number;
  storeRps: number;
  totalRps: number;
  errors: number;
  obsRps: number;
  obsP50Ms: number;
  obsP99Ms: number;
}> {
  const server = spawnServe(port);
  try {
    await readReadyPid(server);
    const base = `http://127.0.0.1:${port}`;
    await Bun.sleep(CAL ? 2_000 : 4_000); // warm-up

    let stop = false;
    const c = { ping: 0, durable: 0, store: 0, errors: 0 };

    const loop = async (
      path: string,
      body: Record<string, unknown>,
      counter: keyof typeof c,
    ): Promise<void> => {
      while (!stop) {
        try {
          const res = await fetch(`${base}${path}`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          await res.arrayBuffer();
          if (!res.ok) c.errors++;
        } catch {
          c.errors++;
          continue;
        }
        c[counter]++;
      }
    };
    // /ping is GET — separate worker shape.
    const pingLoop = async (): Promise<void> => {
      while (!stop) {
        try {
          const res = await fetch(`${base}/ping`);
          await res.arrayBuffer();
          if (!res.ok) c.errors++;
        } catch {
          c.errors++;
          continue;
        }
        c.ping++;
      }
    };

    const workers = [
      ...Array.from({ length: PING_WORKERS }, pingLoop),
      ...Array.from({ length: DURABLE_WORKERS }, () =>
        loop("/_/bench/durable", {}, "durable"),
      ),
      ...Array.from({ length: STORE_WORKERS }, () =>
        loop("/_/bench/rls", { n: 1 }, "store"),
      ),
    ];
    const running = Promise.all(workers);

    const obsLats: number[] = [];
    let obsQueries = 0;
    if (observers && sql) {
      const decl = signal("g10-watch", { delivery: "once", optional: true });
      const consoleBus: SignalBus = await openPostgresSignal({
        signals: new Map([[decl.name, decl]]),
        sql,
        leaseMs: 5_000,
      });
      const config = createMemorySignalConfigStore();
      const observerLoop = async (): Promise<void> => {
        while (!stop) {
          const s = performance.now();
          try {
            await projectSignalsList({ manifest: null, config, bus: consoleBus });
          } catch {
            /* observability panel is read-only; never fail the load arm */
          }
          obsLats.push(performance.now() - s);
          obsQueries++;
        }
      };
      for (let i = 0; i < OBSERVER_LOOPS; i++) void observerLoop();
    }

    await Bun.sleep(ARM_S * 1000);
    stop = true;
    await running;

    const wallS = ARM_S;
    return {
      pingRps: Number((c.ping / wallS).toFixed(1)),
      durableRps: Number((c.durable / wallS).toFixed(1)),
      storeRps: Number((c.store / wallS).toFixed(1)),
      totalRps: Number(((c.ping + c.durable + c.store) / wallS).toFixed(1)),
      errors: c.errors,
      obsRps: Number((obsQueries / wallS).toFixed(2)),
      obsP50Ms: Number(percentile(obsLats, 50).toFixed(1)),
      obsP99Ms: Number(percentile(obsLats, 99).toFixed(1)),
    };
  } finally {
    server.kill();
    await server.exited.catch(() => {});
  }
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G10 — observability contention", () => {
  test(
    `app alone vs app + console signals queries × ${ARM_S}s/arm — req/sec delta`,
    async () => {
      // Arm A: load only.
      const a = await runArm(6677, false, null);
      // Arm B: identical load + observability panel queries.
      const sql = createBunSignalSql(LIVE_PG!);
      const b = await runArm(6678, true, sql);
      await sql.close().catch(() => {});

      const deltaPct = (x: number, y: number): number =>
        x > 0 ? Number((((y - x) / x) * 100).toFixed(1)) : -1;

      const metrics: Record<string, number> = {
        armSeconds: ARM_S,
        armATotalRps: a.totalRps,
        armAPingRps: a.pingRps,
        armADurableRps: a.durableRps,
        armAStoreRps: a.storeRps,
        armBTotalRps: b.totalRps,
        armBPingRps: b.pingRps,
        armBDurableRps: b.durableRps,
        armBStoreRps: b.storeRps,
        totalDeltaPct: deltaPct(a.totalRps, b.totalRps),
        pingDeltaPct: deltaPct(a.pingRps, b.pingRps),
        durableDeltaPct: deltaPct(a.durableRps, b.durableRps),
        storeDeltaPct: deltaPct(a.storeRps, b.storeRps),
        consoleQueriesPerSec: b.obsRps,
        consoleQueryP50Ms: b.obsP50Ms,
        consoleQueryP99Ms: b.obsP99Ms,
        errorsA: a.errors,
        errorsB: b.errors,
      };

      const issues: string[] = [];
      if (a.errors + b.errors > 0) issues.push(`errors: armA=${a.errors} armB=${b.errors}`);
      if (metrics.totalDeltaPct! < -25) {
        issues.push(
          `observability panel costs ${Math.abs(metrics.totalDeltaPct!)}% of throughput on the shared pool`,
        );
      }

      console.log("[G10] metrics:", JSON.stringify(metrics));
      const path = await writeArtifact({
        group: "G10-observability-contention",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g10-observability-contention.bench.ts --timeout 600000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G10] artifact: ${path}`);

      expect(a.errors).toBeLessThan(10);
      expect(b.errors).toBeLessThan(10);
      expect(b.totalRps).toBeGreaterThan(0);
    },
    CAL ? 120_000 : 500_000,
  );
});
