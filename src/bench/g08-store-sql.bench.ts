/**
 * G8a — store.sql sustained insert/update (live Postgres via pgdog).
 *
 * Drives `createStoreRuntime` → `sharedSqlConn` through the public
 * `runtime.open()` path (same connection the fx layer uses), then hammers:
 *   1. sustained single-row INSERTs,
 *   2. sustained point UPDATEs,
 *   3. mixed insert+update interleave.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g08-store-sql.bench.ts --timeout 300000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postgresDriver } from "../drivers/postgres.ts";
import { sql } from "../elements/store/declare.ts";
import { defineTable } from "../elements/store/table.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "../elements/store/sql-session.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import { okid } from "../okid.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
/** Ops per phase — sized so each full run is ~30–60 s against pgdog. */
const OPS = CAL ? 200 : 2_000;

const db = sql("g8sql");
const rows = defineTable("oke_bench_g8_rows", {
  id: true,
  n: true,
  at: true,
});

let handle: SqlStoreHandle;
let runtime: ReturnType<typeof createStoreRuntime>;

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G8 needs live Postgres: set OKE_TEST_POSTGRES=1 + DATABASE_URL");
  runtime = createStoreRuntime({
    drivers: { sql: postgresDriver },
    sql: { g8sql: { name: "g8sql", primary: { url: LIVE_PG } } },
    now: () => Date.now(),
  });
  runtime.register(db);
  const conn = await runtime.primarySql();
  if (!conn) throw new Error("G8: runtime.primarySql() returned undefined");
  await conn.exec(`
    CREATE TABLE IF NOT EXISTS oke_bench_g8_rows (
      id TEXT PRIMARY KEY,
      n BIGINT NOT NULL DEFAULT 0,
      at BIGINT NOT NULL DEFAULT 0
    )
  `);
  await conn.exec(`DELETE FROM oke_bench_g8_rows WHERE id LIKE 'bench-g8-%'`);
  // Same session shape the fx layer builds: shared conn, no PII classes.
  handle = createSqlStoreHandle(db.ref, {
    connection: conn,
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
  });
}, 20_000);

afterAll(async () => {
  try {
    const conn = await runtime?.primarySql();
    await conn?.exec(`DELETE FROM oke_bench_g8_rows WHERE id LIKE 'bench-g8-%'`);
  } catch {
    /* best-effort cleanup */
  }
  await runtime?.close();
});

async function timedPhase(
  name: string,
  op: (i: number) => Promise<unknown>,
): Promise<{
  latencies: number[];
}> {
  const latencies: number[] = [];
  for (let i = 0; i < OPS; i++) {
    const t0 = performance.now();
    await op(i);
    latencies.push(performance.now() - t0);
  }
  latencies.sort((a, b) => a - b);
  console.log(
    `[G8a] ${name}: ops=${OPS} p50=${percentile(latencies, 50).toFixed(3)}ms ` +
      `p99=${percentile(latencies, 99).toFixed(3)}ms`,
  );
  return { latencies };
}

function metricsFor(label: string, latencies: number[], wallS: number): Record<string, number> {
  return {
    [`${label}.ops`]: latencies.length,
    [`${label}.p50Ms`]: Number(percentile(latencies, 50).toFixed(3)),
    [`${label}.p99Ms`]: Number(percentile(latencies, 99).toFixed(3)),
    [`${label}.opsPerSec`]: Number((latencies.length / wallS).toFixed(1)),
  };
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G8a — store.sql sustained", () => {
  test(
    "sustained insert / update / mixed against live postgres",
    async () => {
      const ids = Array.from({ length: OPS }, () => `bench-g8-${okid()}`);
      const metrics: Record<string, number> = {};

      // 1. Sustained inserts.
      let t0 = performance.now();
      const ins = await timedPhase("insert", (i) =>
        handle.insert(rows).values({ id: ids[i]!, n: i, at: Date.now() }).execute(),
      );
      let wallS = (performance.now() - t0) / 1000;
      Object.assign(metrics, metricsFor("insert", ins.latencies, wallS));

      // 2. Sustained point updates.
      t0 = performance.now();
      const upd = await timedPhase("update", (i) =>
        handle
          .update(rows)
          .set({ n: i + 1 })
          .where({ id: ids[i]! }),
      );
      wallS = (performance.now() - t0) / 1000;
      Object.assign(metrics, metricsFor("update", upd.latencies, wallS));

      // 3. Mixed interleave — read-modify-write pairs.
      t0 = performance.now();
      const mixLatencies: number[] = [];
      for (let i = 0; i < OPS; i++) {
        const s = performance.now();
        const found = await handle.select().from(rows).where({ id: ids[i]! }).limit(1);
        if (found.length !== 1) throw new Error(`G8a mixed: row ${ids[i]} missing`);
        await handle
          .update(rows)
          .set({ n: i + 2 })
          .where({ id: ids[i]! });
        mixLatencies.push(performance.now() - s);
      }
      wallS = (performance.now() - t0) / 1000;
      Object.assign(metrics, metricsFor("mixed", mixLatencies, wallS));
      Object.assign(metrics, { mixedReadThenWritePairs: OPS });

      // Sanity: last update landed.
      const check = await handle
        .select()
        .from(rows)
        .where({ id: ids[OPS - 1]! })
        .limit(1);
      expect(Number(check[0]?.n)).toBe(OPS + 1);

      console.log("[G8a] metrics:", JSON.stringify(metrics));
      const issues: string[] = [];
      if (metrics["update.opsPerSec"]! < metrics["insert.opsPerSec"]! * 0.3) {
        issues.push(
          `update throughput collapsed vs insert: ${metrics["update.opsPerSec"]} < 30% of ${metrics["insert.opsPerSec"]}`,
        );
      }

      const path = await writeArtifact({
        group: "G8a",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g08-store-sql.bench.ts --timeout 300000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G8a] artifact: ${path}`);
      expect(issues.length).toBe(0);
    },
    CAL ? 90_000 : 300_000,
  );
});
