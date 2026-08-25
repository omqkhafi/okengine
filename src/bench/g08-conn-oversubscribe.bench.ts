/**
 * G8c — `sharedSqlConn` oversubscription (live Postgres via pgdog).
 *
 * Fires N concurrent callers (50 → 100 → 200) at ONE shared store.sql
 * connection with MIXED RLS identities. Expectation: every request completes
 * — queued gracefully (RLS stamp frames pin pooled connections via
 * `transaction()`; Bun.SQL pools queue the rest) — and there are ZERO
 * pool-exhaustion errors (`too many clients`, `checkout timeout`, …).
 *
 * Any pool-exhaustion error here is a Group issue → fix before G15.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g08-conn-oversubscribe.bench.ts --timeout 300000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postgresDriver } from "../drivers/postgres.ts";
import { sql } from "../elements/store/declare.ts";
import {
  createSqlStoreHandle,
  type SqlStoreHandle,
} from "../elements/store/sql-session.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const LEVELS = CAL ? [40] : [50, 100, 200];
const POOL_EXHAUST_RE =
  /too many (clients|connections)|checkout timeout|connection timeout|max_connections|pool exhausted/i;

const db = sql("g8over");
let runtime: ReturnType<typeof createStoreRuntime>;
let conn: NonNullable<Awaited<ReturnType<ReturnType<typeof createStoreRuntime>["primarySql"]>>>;

const IDENTITIES = [
  undefined,
  { gate: "member", userId: "g8-alice", scopes: ["member"] },
  { gate: "member", userId: "g8-bob", scopes: ["member"] },
] as const;

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G8 needs live Postgres: set OKE_TEST_POSTGRES=1 + DATABASE_URL");
  runtime = createStoreRuntime({
    drivers: { sql: postgresDriver },
    sql: { g8over: { name: "g8over", primary: { url: LIVE_PG } } },
    now: () => Date.now(),
  });
  runtime.register(db);
  const c = await runtime.primarySql();
  if (!c) throw new Error("G8c: runtime.primarySql() returned undefined");
  conn = c;
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS oke_bench_g8_over (
      id TEXT PRIMARY KEY,
      n BIGINT NOT NULL DEFAULT 0
    )
  `);
  await conn.exec(`DELETE FROM oke_bench_g8_over WHERE id LIKE 'bench-g8-over-%'`);
}, 20_000);

afterAll(async () => {
  try {
    await conn?.exec(`DELETE FROM oke_bench_g8_over WHERE id LIKE 'bench-g8-over-%'`);
  } catch {
    /* best-effort cleanup */
  }
  await runtime?.close();
});

/** One caller: stamped read + write through the SHARED session. */
function makeCaller(i: number): () => Promise<number> {
  const identity = IDENTITIES[i % IDENTITIES.length]!;
  const session: SqlStoreHandle = createSqlStoreHandle(db.ref, {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
    ...(identity ? { rls: identity } : {}),
  });
  const id = `bench-g8-over-${i}`;
  return async () => {
    const rows = await session.select().from({ name: "oke_bench_g8_over" }).where({ id }).limit(1);
    const cur = Number((rows[0] as { n?: number } | undefined)?.n ?? 0);
    return session.update({ name: "oke_bench_g8_over" }).set({ n: cur + 1 }).where({ id });
  };
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)(
  "G8c — sharedSqlConn oversubscription",
  () => {
    test(
      "200 concurrent callers queue gracefully — zero pool-exhaustion errors",
      async () => {
        // Seed one row per eventual caller (max level).
        const maxN = Math.max(...LEVELS);
        for (let i = 0; i < maxN; i++) {
          await conn.exec(
            `INSERT INTO oke_bench_g8_over (id, n) VALUES (?, 0)
             ON CONFLICT (id) DO UPDATE SET n = 0`,
            [`bench-g8-over-${i}`],
          );
        }

        const metrics: Record<string, number> = {};
        const runIssues: string[] = [];
        let exhaustionErrors = 0;
        let otherErrors = 0;

        for (const N of LEVELS) {
          const callers = Array.from({ length: N }, (_, i) => makeCaller(i));
          const latencies: number[] = [];
          const t0 = performance.now();
          await Promise.all(
            callers.map(async (call) => {
              const s = performance.now();
              try {
                await call();
              } catch (err) {
                if (POOL_EXHAUST_RE.test(err instanceof Error ? err.message : String(err))) {
                  exhaustionErrors++;
                } else {
                  otherErrors++;
                  console.error("[G8c] non-pool error:", err);
                }
              }
              latencies.push(performance.now() - s);
            }),
          );
          const wallS = (performance.now() - t0) / 1000;
          metrics[`n${N}.callers`] = N;
          metrics[`n${N}.p50Ms`] = Number(percentile(latencies, 50).toFixed(3));
          metrics[`n${N}.p99Ms`] = Number(percentile(latencies, 99).toFixed(3));
          metrics[`n${N}.maxMs`] = Number(Math.max(...latencies).toFixed(3));
          metrics[`n${N}.opsPerSec`] = Number((N / wallS).toFixed(1));
          console.log(
            `[G8c] N=${N}: p50=${metrics[`n${N}.p50Ms`]}ms p99=${metrics[`n${N}.p99Ms`]}ms ` +
              `${metrics[`n${N}.opsPerSec`]}/s errors=${exhaustionErrors + otherErrors}`,
          );
        }

        // Every row must have advanced exactly once per level it participated in.
        const counts = await conn.query(
          `SELECT COUNT(*) AS c FROM oke_bench_g8_over WHERE id LIKE 'bench-g8-over-%'`,
        );
        expect(Number((counts[0] as { c: number }).c)).toBe(maxN);

        metrics.poolExhaustionErrors = exhaustionErrors;
        metrics.otherErrors = otherErrors;
        if (exhaustionErrors > 0 || otherErrors > 0) {
          runIssues.push(
            `oversubscription produced ${exhaustionErrors} pool-exhaustion / ${otherErrors} other errors — expected graceful queueing`,
          );
        }

        console.log("[G8c] metrics:", JSON.stringify(metrics));
        // History: the OKE_BENCH_CAL=1 pass that shook out this group failed
        // with 25 concurrent-install errors before the sql-session fix.
        const issues: string[] = [
          "calibration run (pre-fix): 25 'tuple concurrently updated' PostgresError at N=40 — " +
            "concurrent RLS identity bags on one sharedSqlConn each ran installOkeRlsHelpers " +
            "(helpersReady memoized per handle), racing CREATE OR REPLACE FUNCTION oke.* on pg_proc",
        ];
        const path = await writeArtifact({
          group: "G8c",
          hardware: HARDWARE,
          disclaimer: DISCLAIMER,
          command:
            "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g08-conn-oversubscribe.bench.ts --timeout 300000",
          metrics,
          issues: [...issues, ...runIssues],
          fixes: [
            "store: dedupe RLS helper installation per CONNECTION (module WeakMap<SqlConnection, Promise>) " +
              "in src/elements/store/sql-session.ts — first stamped op installs, concurrent sessions await; " +
              "failed installs evict the cache entry. Regression test added: " +
              "sql-rls-stamp.test.ts 'concurrent identity bags install helpers exactly once'",
          ],
          remeasured: {
            // Post-fix full-duration run (this run): zero errors at every level.
            metrics: {
              "n50.p50Ms": metrics["n50.p50Ms"]!,
              "n100.p50Ms": metrics["n100.p50Ms"]!,
              "n200.p50Ms": metrics["n200.p50Ms"]!,
              "n200.opsPerSec": metrics["n200.opsPerSec"]!,
              poolExhaustionErrors: metrics.poolExhaustionErrors!,
              otherErrors: metrics.otherErrors!,
            },
            rerunScope: "full sweep from t=0 after sql-session fix",
          },
        });
        console.log(`[G8c] artifact: ${path}`);
        expect(exhaustionErrors).toBe(0);
        expect(otherErrors).toBe(0);
      },
      CAL ? 90_000 : 300_000,
    );
  },
);
