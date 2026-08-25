/**
 * G15 — Postgres degradation (in-process backpressure).
 *
 * Test-only driver wrapper honors `OKE_BENCH_PG_DELAY_MS`: every
 * query/exec awaits `Bun.sleep(delay)` BEFORE hitting live Postgres
 * (preferred over pgdog network delays for reproducibility). Live PG only —
 * never PGlite.
 *
 * Open-loop arrivals hammer ONE sharedSqlConn through RLS-stamped sessions
 * while SQL is stalled at 500ms/query. Watch: unbounded `withRlsStampLock`
 * queue growth / OOM vs loud bounded errors.
 *
 * MANDATORY HONESTY NOTE (carried in the artifact): this is an IN-PROCESS
 * BACKPRESSURE TEST ONLY — it does NOT simulate network jitter, disk
 * contention, or pooler failure modes.
 *
 * Run: OKE_BENCH=1 OKE_BENCH_PG_DELAY_MS=500 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g15-postgres-degradation.bench.ts --timeout 300000
 */

import { describe, expect, test } from "bun:test";
import { connectPostgres, postgresDriver } from "../drivers/postgres.ts";
import type { SqlDriver, SqlConnection } from "../drivers/types.ts";
import { sql } from "../elements/store/declare.ts";
import {
  createSqlStoreHandle,
  type SqlStoreHandle,
} from "../elements/store/sql-session.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { measureEventLoopLag } from "./lib/event-loop-lag.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const DELAY_MS = Math.max(0, Number(process.env.OKE_BENCH_PG_DELAY_MS ?? "500"));
const DURATION_S = CAL ? 12 : Math.max(10, Number(process.env.OKE_BENCH_G15_S ?? "30"));
const ARRIVALS_PER_SEC = CAL ? 6 : Math.max(1, Number(process.env.OKE_BENCH_G15_RATE ?? "10"));
const SAMPLE_MS = 250;

/**
 * Test-only driver wrapper: injects `Bun.sleep(DELAY_MS)` before every
 * query/exec on connections this driver opens. Transaction pinning and
 * role routing pass through untouched.
 */
function delayedPostgresDriver(delayMs: number): SqlDriver {
  if (delayMs <= 0) return postgresDriver;
  return {
    id: "postgres",
    facet: "sql",
    connect: async (options): Promise<SqlConnection> => {
      const conn = await connectPostgres(options);
      const slowed: SqlConnection = {
        driverId: conn.driverId,
        role: conn.role,
        async query(text, params = []) {
          await Bun.sleep(delayMs);
          return conn.query(text, params);
        },
        async exec(text, params = []) {
          await Bun.sleep(delayMs);
          return conn.exec(text, params);
        },
        transaction(fn) {
          if (!conn.transaction) {
            throw new Error("G15: underlying postgres connection lacks transaction()");
          }
          return conn.transaction(fn);
        },
        close() {
          return conn.close();
        },
      };
      return slowed;
    },
  };
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)(
  "G15 — Postgres degradation (in-process backpressure)",
  () => {
    test(
      `open-loop ${ARRIVALS_PER_SEC}/s vs sharedSqlConn @ ${DELAY_MS}ms/query for ${DURATION_S}s`,
      async () => {
        const db = sql("g15degrade");
        const runtime = createStoreRuntime({
          drivers: { sql: delayedPostgresDriver(DELAY_MS) },
          sql: { g15degrade: { name: "g15degrade", primary: { url: LIVE_PG! } } },
          now: () => Date.now(),
        });
        runtime.register(db);
        const maybeConn = await runtime.primarySql();
        if (!maybeConn) throw new Error("G15: runtime.primarySql() returned undefined");
        const c: SqlConnection = maybeConn;
        // DDL is stamp-exempt — set up before the stall matters anyway.
        await c.exec(`CREATE TABLE IF NOT EXISTS oke_bench_g15 (
          id TEXT PRIMARY KEY, n BIGINT NOT NULL DEFAULT 0)`);
        await c.exec(
          `INSERT INTO oke_bench_g15 (id, n) VALUES ('g15-counter', 0)
           ON CONFLICT (id) DO UPDATE SET n = 0`,
        );

        const IDENTITIES = [
          undefined,
          { gate: "member", userId: "g15-alice", scopes: ["member"] },
          { gate: "member", userId: "g15-bob", scopes: ["member"] },
        ] as const;
        let handleIdx = 0;
        function nextSession(): SqlStoreHandle {
          const identity = IDENTITIES[handleIdx % IDENTITIES.length]!;
          handleIdx++;
          return createSqlStoreHandle(db.ref, {
            connection: c,
            classifications: new Map(),
            routedRole: "primary",
            domainDdl: "off",
            ...(identity ? { rls: identity } : {}),
          });
        }

        let inflight = 0;
        let maxInflight = 0;
        let completed = 0;
        let failed = 0;
        const failureSamples: string[] = [];

        async function oneOp(): Promise<void> {
          inflight++;
          if (inflight > maxInflight) maxInflight = inflight;
          try {
            const session = nextSession();
            const rows = await session
              .select()
              .from({ name: "oke_bench_g15" })
              .where({ id: "g15-counter" })
              .limit(1);
            const cur = Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
            await session
              .update({ name: "oke_bench_g15" })
              .set({ n: cur + 1 })
              .where({ id: "g15-counter" });
            completed++;
          } catch (err) {
            failed++;
            if (failureSamples.length < 5) {
              failureSamples.push(err instanceof Error ? err.message : String(err));
            }
          } finally {
            inflight--;
          }
        }

        // Background samplers.
        const rssSamples: { tMs: number; rssMb: number }[] = [];
        const inflightSamples: { tMs: number; inflight: number }[] = [];
        const t0 = performance.now();
        const samplerId = setInterval(() => {
          const tMs = performance.now() - t0;
          rssSamples.push({ tMs, rssMb: process.memoryUsage.rss() / 1024 / 1024 });
          inflightSamples.push({ tMs, inflight });
        }, SAMPLE_MS);
        const lag = measureEventLoopLag(100);

        // Open-loop arrivals: fixed cadence regardless of completion.
        const arrivalId = setInterval(() => void oneOp(), 1000 / ARRIVALS_PER_SEC);
        await Bun.sleep(DURATION_S * 1000);
        clearInterval(arrivalId);
        clearInterval(samplerId);
        lag.stop();

        // Let the CURRENTLY ARRIVING tick settle, then freeze the picture.
        await Bun.sleep(50);
        const finalInflight = inflight;

        const rssStart = rssSamples[0]?.rssMb ?? 0;
        const rssEnd = rssSamples.at(-1)?.rssMb ?? 0;
        // Least-squares MB/min over all samples.
        const n = rssSamples.length;
        let rssSlope = 0;
        if (n >= 2) {
          const sx = rssSamples.reduce((a, s) => a + s.tMs, 0);
          const sy = rssSamples.reduce((a, s) => a + s.rssMb, 0);
          const sxy = rssSamples.reduce((a, s) => a + s.tMs * s.rssMb, 0);
          const sxx = rssSamples.reduce((a, s) => a + s.tMs * s.tMs, 0);
          rssSlope = ((n * sxy - sx * sy) / (n * sxx - sx * sx || 1)) * 60_000;
        }

        const lags = lag.lags();
        const metrics: Record<string, number> = {
          pgDelayMs: DELAY_MS,
          durationS: DURATION_S,
          arrivalsPerSec: ARRIVALS_PER_SEC,
          completedOps: completed,
          failedOps: failed,
          errorRatePct: Number(((failed / (completed + failed || 1)) * 100).toFixed(3)),
          opsPerSec: Number((completed / DURATION_S).toFixed(2)),
          maxInflight: maxInflight,
          finalInflight: finalInflight,
          avgInflight: Number(
            (
              inflightSamples.reduce((a, s) => a + s.inflight, 0) /
              (inflightSamples.length || 1)
            ).toFixed(1),
          ),
          rssStartMb: Number(rssStart.toFixed(1)),
          rssEndMb: Number(rssEnd.toFixed(1)),
          rssGrowthMb: Number((rssEnd - rssStart).toFixed(1)),
          rssSlopeMbPerMin: Number(rssSlope.toFixed(2)),
          lagP50Ms: Number(percentile(lags, 50).toFixed(2)),
          lagP99Ms: Number(percentile(lags, 99).toFixed(2)),
          lagMaxMs: lags.length > 0 ? Number(Math.max(...lags).toFixed(2)) : 0,
        };

        const issues: string[] = [];
        if (failed > 0) {
          issues.push(
            `${failed} op(s) failed under stall — sample errors: ${failureSamples.join(" | ")}`,
          );
        }
        if (metrics.rssSlopeMbPerMin! > 100 || metrics.rssGrowthMb! > 300) {
          issues.push(
            `RSS grew ${metrics.rssGrowthMb}MB (${metrics.rssSlopeMbPerMin}MB/min) — OOM-shaped growth while the withRlsStampLock queue built up`,
          );
        }
        if (metrics.lagP99Ms! > 250) {
          issues.push(`event-loop lag p99 ${metrics.lagP99Ms}ms — backpressure is leaking onto the loop`);
        }
        if (issues.length === 0 && finalInflight > ARRIVALS_PER_SEC) {
          issues.push(
            `note (expected physics): withRlsStampLock queue grew UNBOUNDED without any loud bounded error — ` +
              `finalInflight=${finalInflight} at cutoff (arrivals ${ARRIVALS_PER_SEC}/s outpace serialized service ~${metrics.opsPerSec}/s at ${DELAY_MS}ms/query). ` +
              `Memory stayed flat (+${metrics.rssGrowthMb}MB), so this is unbounded LATENCY exposure, not OOM — callers wait forever instead of failing fast`,
          );
        }

        console.log("[G15] metrics:", JSON.stringify(metrics));
        if (issues.length > 0) console.log("[G15] issues:", issues);

        const path = await writeArtifact({
          group: "G15-postgres-degradation",
          hardware: HARDWARE,
          disclaimer: DISCLAIMER,
          command:
            "OKE_BENCH=1 OKE_BENCH_PG_DELAY_MS=500 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g15-postgres-degradation.bench.ts --timeout 300000",
          metrics,
          issues: [
            // Mandatory honesty note — in the artifact, not just the header.
            "HONESTY NOTE: in-process backpressure test only — does not simulate network jitter, disk contention, or pooler failure modes",
            ...issues,
          ],
          fixes: [],
          remeasured: null,
        });
        console.log(`[G15] artifact: ${path}`);

        expect(failed).toBe(0);
        expect(completed).toBeGreaterThan(0);
        // Backpressure must be observable: the queue builds instead of
        // silently dropping work.
        expect(maxInflight).toBeGreaterThan(ARRIVALS_PER_SEC);

        // Do not drain the multi-minute queue — abandon it with the runtime.
        await runtime.close().catch(() => {});
      },
      CAL ? 90_000 : 300_000,
    );
  },
);
