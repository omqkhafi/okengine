/**
 * G2 — clock.perTenant lease contention (live Postgres via pgdog).
 *
 * Seeds ≥100 `oke_crons` rows named via {@link perTenantCronName}, then fires
 * concurrent lease acquisitions through `acquireLease` (which runs
 * `CLAIM_LEASE_SQL` = `FOR UPDATE SKIP LOCKED`). Two phases:
 *
 *   1. Correctness: C instances race for ONE name with a long lease —
 *      exactly 1 winner, duplicate-fire count === 0.
 *   2. Throughput: N tenants × K concurrent claimers sweep; histogram of
 *      claim latencies + claims/sec.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g02-clock-per-tenant.bench.ts --timeout 180000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { perTenantCronName } from "../elements/clock/declare.ts";
import type { CronRow } from "../elements/clock/reconcile.ts";
import { createPostgresCronStore, type PostgresCronSql } from "../drivers/clock-postgres.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const TENANTS = CAL ? 20 : 120;
const CLAIMERS_PER_TENANT = CAL ? [4] : [4, 16];
const CONTENTION_LEASE_MS = CAL ? 5_000 : 30_000;
/** Prefix so we only ever touch our own rows on cleanup. */
const TEMPLATE = "bench-g2-cron";

let store: Awaited<ReturnType<typeof createPostgresCronStore>>;

function seedRow(name: string): CronRow {
  return {
    name,
    declaredEvery: "1h",
    effectiveEvery: "1h",
    timezone: "UTC",
    overridable: false,
    status: "active",
  };
}

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G2 needs live Postgres: set OKE_TEST_POSTGRES=1 + DATABASE_URL");
  store = await createPostgresCronStore({ url: LIVE_PG });
}, 15_000);

afterAll(async () => {
  if (!store) return;
  // Delete only rows this bench seeded.
  await store.sql.exec(`DELETE FROM oke_crons WHERE name LIKE ?`, [`${TEMPLATE}#%`]);
  await store.close();
});

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G2 — perTenant lease contention", () => {
  test("correctness: concurrent claimers → exactly one holder, zero duplicate fires", async () => {
    const name = perTenantCronName(TEMPLATE, "dupe-check");
    const existing = await store.get(name);
    if (!existing) await store.put(seedRow(name));

    const C = 24;
    const results = await Promise.all(
      Array.from({ length: C }, (_, i) =>
        store.acquireLease(name, `g2-instance-${i}`, Date.now(), CONTENTION_LEASE_MS),
      ),
    );
    const winners = results.filter(Boolean).length;
    expect(winners).toBe(1);

    const row = await store.get(name);
    expect(row?.leaderInstanceId ?? (await rawLeader())).toBeTruthy();
  }, 60_000);

  test(
    "throughput sweep: tenants × concurrent claimers",
    async () => {
      const names = Array.from({ length: TENANTS }, (_, i) => perTenantCronName(TEMPLATE, `t${i}`));
      // Seed (idempotent).
      const have = new Set((await store.list()).map((r) => r.name));
      for (const n of names) if (!have.has(n)) await store.put(seedRow(n));

      const metrics: Record<string, number> = {};
      let totalDuplicateFires = 0;
      const allLatencies: number[] = [];

      for (const k of CLAIMERS_PER_TENANT) {
        const latencies: number[] = [];
        let wins = 0;
        const t0 = performance.now();
        // Wave: every tenant contested by k claimers at once.
        const rounds = CAL ? 1 : 3;
        for (let r = 0; r < rounds; r += 1) {
          await Promise.all(
            names.flatMap((name) =>
              Array.from({ length: k }, (_, i) => {
                const s = performance.now();
                return store
                  .acquireLease(name, `g2-sweep-${r}-${i}`, Date.now(), 60_000)
                  .then((ok) => {
                    latencies.push(performance.now() - s);
                    if (ok) wins += 1;
                  });
              }),
            ),
          );
        }
        const wallS = (performance.now() - t0) / 1000;
        // Each (tenant, round) must elect exactly one holder per lease window.
        const expectedWins = names.length * rounds;
        const duplicateFires = Math.max(0, wins - expectedWins);
        totalDuplicateFires += duplicateFires;

        const p50 = percentile(latencies, 50);
        const p99 = percentile(latencies, 99);
        metrics[`k${k}.claims`] = latencies.length;
        metrics[`k${k}.p50Ms`] = Number(p50.toFixed(3));
        metrics[`k${k}.p99Ms`] = Number(p99.toFixed(3));
        metrics[`k${k}.maxMs`] = Number(Math.max(...latencies).toFixed(3));
        metrics[`k${k}.claimsPerSec`] = Number((latencies.length / wallS).toFixed(1));
        metrics[`k${k}.duplicateFires`] = duplicateFires;
        allLatencies.push(...latencies);
      }

      console.log("[G2] metrics:", JSON.stringify(metrics));

      const issues: string[] = [];
      if (totalDuplicateFires > 0) {
        issues.push(
          `duplicate lease fires observed: ${totalDuplicateFires} (CLAIM_LEASE_SQL correctness)`,
        );
      }

      const path = await writeArtifact({
        group: "G2",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g02-clock-per-tenant.bench.ts --timeout 180000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G2] artifact: ${path}`);
      expect(totalDuplicateFires).toBe(0);
    },
    CAL ? 90_000 : 180_000,
  );
});

/** Fallback leader read when the CronRow mapping hides the lease columns. */
async function rawLeader(): Promise<string | null> {
  const sql: PostgresCronSql = store.sql;
  const rows = await sql.query(`SELECT locked_by FROM oke_crons WHERE name = ?`, [
    perTenantCronName(TEMPLATE, "dupe-check"),
  ]);
  return (rows[0] as { locked_by?: string | null } | undefined)?.locked_by ?? null;
}
