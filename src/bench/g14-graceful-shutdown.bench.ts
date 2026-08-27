/**
 * G14 — graceful shutdown under load.
 *
 * Extends the `instances-chaos-child.ts` graceful-hold pattern through
 * `load-child shutdown-test` semantics, but with the REAL app: a full
 * `load-child serve` boot installs `installGracefulShutdown`
 * (`src/kernel/graceful-shutdown.ts`) over its server handle.
 *
 * Scenario: 220 held SSE subscribers (`load-child flood-sse`) + sustained
 * HTTP load mixing `/ping` and sharedSqlConn RLS stamp writes. Then a FROZEN
 * in-flight batch of 50 RLS stamp writes is launched, SIGTERM lands while
 * they are mid-handler, and their outcomes classify the drain exactly:
 *   - completed vs dropped requests,
 *   - time-to-exit,
 *   - pending sharedSqlConn stamp ops completing AFTER the signal (drain).
 *
 * No request is initiated after SIGTERM, so every error is a genuinely
 * dropped in-flight request — no new-connection-refusal noise.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… OKE_TEST_REDIS_URL=… bun test ./src/bench/g14-graceful-shutdown.bench.ts --timeout 120000
 */

import { describe, expect, test } from "bun:test";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const PORT = 6679;
const BASE = `http://127.0.0.1:${PORT}`;
const SSE_COUNT = CAL ? 60 : 220;
const PING_WORKERS = 20;
const RLS_WORKERS = 40;
const INFLIGHT_BATCH = CAL ? 20 : 50;
const WARM_MS = CAL ? 2_000 : 4_000;
const LOAD_MS = CAL ? 2_000 : 4_000;

type Server = Bun.Subprocess<"ignore", "pipe", "ignore">;

function spawnServe(): Server {
  return Bun.spawn(["bun", "run", "src/bench/load-child.ts", "serve", String(PORT)], {
    stdout: "pipe",
    stderr: "ignore",
    env: process.env,
  });
}

function spawnFloodSse(count: number): Bun.Subprocess<"ignore", "pipe", "ignore"> {
  return Bun.spawn(
    ["bun", "run", "src/bench/load-child.ts", "flood-sse", BASE, "bench-live", String(count)],
    { stdout: "pipe", stderr: "ignore", env: process.env },
  );
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

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G14 — graceful shutdown under load", () => {
  test(
    `${SSE_COUNT} SSE + ${PING_WORKERS + RLS_WORKERS} workers → frozen in-flight batch → SIGTERM → drain`,
    async () => {
      const server = spawnServe();
      const pid = await readReadyPid(server);
      console.log(`[G14] server ready pid=${pid}`);
      await Bun.sleep(WARM_MS);

      // Hold SSE subscribers in a separate child so the test process only
      // runs the closing HTTP load.
      const flood = spawnFloodSse(SSE_COUNT);
      await Bun.sleep(1_500); // let subscribers attach

      let stopLoad = false;
      const c = { ping: 0, rls: 0, errorsBeforeSignal: 0 };

      const pingLoop = async (): Promise<void> => {
        while (!stopLoad) {
          try {
            const res = await fetch(`${BASE}/ping`);
            await res.arrayBuffer();
            if (!res.ok) c.errorsBeforeSignal++;
            else c.ping++;
          } catch {
            if (!stopLoad) c.errorsBeforeSignal++;
          }
        }
      };
      const rlsLoop = async (): Promise<void> => {
        while (!stopLoad) {
          try {
            const res = await fetch(`${BASE}/_/bench/rls`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tenantId: `g14-${Math.floor(Math.random() * 8)}`, n: 1 }),
            });
            await res.arrayBuffer();
            if (!res.ok) c.errorsBeforeSignal++;
            else c.rls++;
          } catch {
            if (!stopLoad) c.errorsBeforeSignal++;
          }
        }
      };

      const running = Promise.all([
        ...Array.from({ length: PING_WORKERS }, pingLoop),
        ...Array.from({ length: RLS_WORKERS }, rlsLoop),
      ]);

      await Bun.sleep(LOAD_MS);
      // Freeze the sustained load; wait for its last requests to settle so
      // nothing except the frozen batch is in flight at signal time.
      stopLoad = true;
      await running;
      expect(c.errorsBeforeSignal).toBe(0);

      // Frozen in-flight batch — multi-roundtrip sharedSqlConn stamp writes.
      // SIGTERM lands while all of these are mid-handler.
      let batchSettled = false;
      let batchDrained = 0;
      let batchDropped = 0;
      const batchErrors: string[] = [];
      const batch = Promise.all(
        Array.from({ length: INFLIGHT_BATCH }, async () => {
          try {
            const res = await fetch(`${BASE}/_/bench/rls`, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ tenantId: "g14-inflight", n: 1 }),
            });
            await res.arrayBuffer();
            if (res.ok && !batchSettled) batchDrained++;
            else if (!batchSettled) batchDropped++;
          } catch (err) {
            if (!batchSettled) {
              batchDropped++;
              if (batchErrors.length < 3) batchErrors.push(String(err));
            }
          }
        }),
      );

      await Bun.sleep(15); // batch is now mid-handler behind the RLS stamps
      const tSignal = performance.now();
      server.kill("SIGTERM");
      await batch;
      batchSettled = true;

      const exitRace = await Promise.race([
        server.exited.then(() => "exited" as const),
        Bun.sleep(20_000).then(() => "timeout" as const),
      ]);
      const timeToExitMs =
        exitRace === "exited" ? Number((performance.now() - tSignal).toFixed(1)) : -1;
      if (exitRace === "timeout") {
        server.kill("SIGKILL");
        await server.exited.catch(() => {});
      }

      // Flood child exits (printing floodDone) once every SSE stream ends.
      const floodExit = await Promise.race([
        flood.exited.then(() => "closed" as const),
        Bun.sleep(10_000).then(() => "timeout" as const),
      ]);
      if (floodExit === "timeout") flood.kill();

      const metrics: Record<string, number> = {
        sseSubscribers: SSE_COUNT,
        sseClosedOnShutdown: floodExit === "closed" ? 1 : 0,
        inflightBatchSize: INFLIGHT_BATCH,
        requestsCompletedBeforeSignal: c.ping + c.rls,
        pingCompletedBeforeSignal: c.ping,
        rlsStampWritesBeforeSignal: c.rls,
        inflightDrainedAfterSignal: batchDrained,
        inflightDroppedAfterSignal: batchDropped,
        droppedRequests: batchDropped,
        timeToExitMs,
      };

      const issues: string[] = [
        // Calibration-run history: the first pass classified post-SIGTERM
        // *new* connection attempts ("unable to connect") as dropped
        // in-flight work. Methodology was corrected to a frozen in-flight
        // batch before the signal — measurement fix, not a product fix.
        "note: first CAL pass used a load-loop that kept opening new requests during the SIGTERM window and miscounted connection refusals as dropped in-flight work; replaced with the frozen in-flight-batch method (no product change)",
      ];
      if (batchDropped > 0) {
        issues.push(
          `${batchDropped}/${INFLIGHT_BATCH} in-flight sharedSqlConn stamp writes dropped across SIGTERM — graceful shutdown did not fully drain: ${batchErrors.join("; ")}`,
        );
      }
      if (timeToExitMs < 0) {
        issues.push("server did not exit within 20s of SIGTERM");
      } else if (timeToExitMs > 10_000) {
        issues.push(`time-to-exit ${timeToExitMs}ms exceeds 10s`);
      }
      if (floodExit !== "closed")
        issues.push("SSE subscribers not all closed within 10s of shutdown");

      console.log("[G14] metrics:", JSON.stringify(metrics));
      if (issues.length > 0) console.log("[G14] issues:", issues);
      const path = await writeArtifact({
        group: "G14-graceful-shutdown",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g14-graceful-shutdown.bench.ts --timeout 120000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G14] artifact: ${path}`);

      expect(c.ping + c.rls).toBeGreaterThan(100);
      expect(c.rls).toBeGreaterThan(10);
      expect(batchDrained).toBeGreaterThanOrEqual(INFLIGHT_BATCH - 2);
    },
    CAL ? 60_000 : 120_000,
  );
});
