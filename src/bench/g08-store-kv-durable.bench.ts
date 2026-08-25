/**
 * G8b — durable KV via `openDurableKv` tenant-prefix path (live Postgres).
 *
 * Durable `store.kv` namespaces are JSONB rows on the shared SQL connection —
 * never a second Redis. The fx layer prefixes keys `{tenantId}:` when the
 * namespace is tenant-scoped (`rewriteKvArgs`), so this bench drives the same
 * shape: one durable namespace, keys written under per-tenant prefixes,
 * get / set / delete ops/sec + a list() sweep.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g08-store-kv-durable.bench.ts --timeout 300000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { postgresDriver } from "../drivers/postgres.ts";
import { kv } from "../elements/store/declare.ts";
import type { KvStoreFxHandle } from "../elements/store/runtime.ts";
import { createStoreRuntime } from "../elements/store/runtime.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const OPS = CAL ? 200 : 2_000;
const TENANTS = CAL ? 2 : 8;

const ns = kv("bench-g8-kv", { durable: true, tenantScoped: true });

let runtime: ReturnType<typeof createStoreRuntime>;
let handle: KvStoreFxHandle;

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G8 needs live Postgres: set OKE_TEST_POSTGRES=1 + DATABASE_URL");
  runtime = createStoreRuntime({
    drivers: { sql: postgresDriver },
    sqlUrl: LIVE_PG,
    now: () => Date.now(),
  });
  runtime.register(ns);
  // Durable decl → openDurableKv → sharedSqlConn → oke_kv table.
  handle = (await runtime.open(ns, { effects: {} })) as KvStoreFxHandle;
  expect(handle.driverId).toBe("postgres");
}, 20_000);

afterAll(async () => {
  try {
    const conn = await runtime?.primarySql();
    // Only our own namespace.
    await conn?.exec(`DELETE FROM oke_kv WHERE namespace = ?`, [ns.ref.slice(3)]);
  } catch {
    /* best-effort cleanup */
  }
  await runtime?.close();
});

function tenantKey(tenant: string, i: number): string {
  // Same prefix shape rewriteKvArgs produces for tenant-scoped namespaces.
  return `${tenant}:k${i}`;
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G8b — durable KV (openDurableKv)", () => {
  test(
    "tenant-prefixed get/set/delete ops/sec on oke_kv",
    async () => {
      const metrics: Record<string, number> = {};
      const tenants = Array.from({ length: TENANTS }, (_, i) => `g8tenant${i}`);

      const phase = async (
        label: string,
        op: (tenant: string, i: number) => Promise<unknown>,
      ): Promise<number[]> => {
        const latencies: number[] = [];
        const t0 = performance.now();
        for (let i = 0; i < OPS; i++) {
          const s = performance.now();
          await op(tenants[i % tenants.length]!, i);
          latencies.push(performance.now() - s);
        }
        const wallS = (performance.now() - t0) / 1000;
        metrics[`${label}.ops`] = latencies.length;
        metrics[`${label}.p50Ms`] = Number(percentile(latencies, 50).toFixed(3));
        metrics[`${label}.p99Ms`] = Number(percentile(latencies, 99).toFixed(3));
        metrics[`${label}.opsPerSec`] = Number((latencies.length / wallS).toFixed(1));
        console.log(
          `[G8b] ${label}: p50=${metrics[`${label}.p50Ms`]}ms p99=${metrics[`${label}.p99Ms`]}ms ` +
            `${metrics[`${label}.opsPerSec`]}/s`,
        );
        return latencies;
      };

      await phase("set", (t, i) => handle.set(tenantKey(t, i), { v: i, t: Date.now() }));
      await phase("get-hit", async (t, i) => {
        const v = (await handle.get(tenantKey(t, i))) as { v: number } | null;
        if (!v || v.v !== i) throw new Error(`G8b: get mismatch for ${t}/k${i}`);
      });
      await phase("get-miss", (t, i) => handle.get(`${t}:missing-${i}`));
      await phase("delete", (t, i) => handle.delete(tenantKey(t, i)));

      // Tenant isolation sanity: after deletes, nothing leaks across prefixes.
      const leaked = await handle.list(`g8tenant0:k0`);
      expect(leaked).toEqual([]);

      // list(prefix) sweep over a fresh tenant's remaining rows.
      for (let i = 0; i < OPS; i++) {
        await handle.set(`g8list:k${i}`, i);
      }
      const tList = performance.now();
      const listed = await handle.list("g8list:");
      metrics.listKeysReturned = listed.length;
      metrics.listMs = Number((performance.now() - tList).toFixed(3));
      expect(listed.length).toBe(OPS);

      console.log("[G8b] metrics:", JSON.stringify(metrics));
      const issues: string[] = [];
      if (metrics["set.opsPerSec"]! < 50) {
        issues.push(`durable kv set throughput low: ${metrics["set.opsPerSec"]}/s`);
      }

      const path = await writeArtifact({
        group: "G8b",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g08-store-kv-durable.bench.ts --timeout 300000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G8b] artifact: ${path}`);
      expect(issues.length).toBe(0);
    },
    CAL ? 90_000 : 300_000,
  );
});
