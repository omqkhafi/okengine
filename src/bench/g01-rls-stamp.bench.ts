/**
 * G1 — Serialized RLS stamp queue (PGlite).
 *
 * Measures stamp-frame serialization latency vs concurrency on ONE shared
 * PGlite connection (`withRlsStampLock` physics). Two bind shapes:
 *   • 3 binds — gate / user / scopes (no tenantId)
 *   • 4 binds — gate / user / scopes + tenantId
 *
 * Expectation: roughly linear inverse degradation with N (the queue working
 * as designed). Super-linear collapse is flagged as an issue.
 *
 * Run: bun test src/bench/g01-rls-stamp.bench.ts --timeout 120000
 * Env: OKE_BENCH=1 (PGlite only — no Docker needed). OKE_BENCH_CAL=1 shrinks
 * iterations for a calibration pass.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../drivers/pglite.ts";
import { installOkeRlsHelpers } from "../drivers/pg-rls.ts";
import type { SqlConnection } from "../drivers/types.ts";
import { createSqlStoreHandle, type SqlStoreHandle } from "../elements/store/sql-session.ts";
import { DISCLAIMER, HARDWARE, summarize, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
/** Concurrent callers per sweep point. */
const CONCURRENCY = CAL ? [10, 50] : [10, 50, 100, 200, 500];
/** Repeats per (N, shape) point — pooled into that point's samples. */
const ROUNDS = CAL ? 1 : 3;

const NOTES_DDL = `CREATE TABLE notes (
  id text PRIMARY KEY,
  owner text NOT NULL,
  body text NOT NULL
)`;

const OWNER_POLICY = `CREATE POLICY owner_select ON notes
  AS PERMISSIVE FOR SELECT TO public
  USING (owner = oke.user())`;

let conn: SqlConnection;
/** 3-bind stamp (gate/user/scopes). */
let asUser3: SqlStoreHandle;
/** 4-bind stamp (+tenantId). */
let asUser4: SqlStoreHandle;

const PROBE_SQL = `SELECT oke.user() AS u, oke.tenant() AS t`;

beforeAll(async () => {
  conn = await connectPglite({ url: "memory://bench-g01-rls-stamp", role: "primary" });
  await conn.exec(NOTES_DDL);
  await conn.exec(`INSERT INTO notes VALUES ('a', 'alice', 'hi'), ('b', 'bob', 'yo')`);
  await conn.exec(`ALTER TABLE notes ENABLE ROW LEVEL SECURITY`);
  await installOkeRlsHelpers((sql) => conn.exec(sql));
  await conn.exec(OWNER_POLICY);

  const base = {
    classifications: new Map(),
    routedRole: "primary",
    domainDdl: "off",
  } as const;
  asUser3 = createSqlStoreHandle("sql:app", {
    ...base,
    connection: conn,
    rls: { gate: "member", userId: "alice", scopes: ["member"] },
  });
  asUser4 = createSqlStoreHandle("sql:app", {
    ...base,
    connection: conn,
    rls: { gate: "member", userId: "bob", scopes: ["member"], tenantId: "acme" },
  });
}, 15_000);

afterAll(async () => {
  await conn.close();
});

interface PointResult {
  readonly n: number;
  readonly shape: "binds3" | "binds4";
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly maxMs: number;
  /** Batch throughput: calls / wall-clock seconds. */
  readonly opsPerSec: number;
}

/**
 * Fire `n` concurrent stamped probes; return per-call end-to-end latency.
 */
async function sweepPoint(
  handle: SqlStoreHandle,
  n: number,
  rounds: number,
): Promise<{ latencies: number[]; opsPerSec: number }> {
  const latencies: number[] = [];
  let wallMs = 0;
  for (let r = 0; r < rounds; r += 1) {
    const t0 = performance.now();
    const times = await Promise.all(
      Array.from({ length: n }, async () => {
        const s = performance.now();
        await handle.raw(PROBE_SQL);
        return performance.now() - s;
      }),
    );
    wallMs += performance.now() - t0;
    latencies.push(...times);
  }
  return { latencies, opsPerSec: (n * rounds) / (wallMs / 1000) };
}

describe.skipIf(!process.env.OKE_BENCH)("G1 — RLS stamp serialization (pglite)", () => {
  test("correctness sanity: concurrent identities do not leak across stamps", async () => {
    const [u3, u4, u3again] = await Promise.all([
      asUser3.raw(PROBE_SQL),
      asUser4.raw(PROBE_SQL),
      asUser3.raw(PROBE_SQL),
    ]);
    expect((u3[0] as { u: string }).u).toBe("alice");
    expect((u4[0] as { u: string }).u).toBe("bob");
    expect((u3[0] as { t: string | null }).t).toBeNull();
    expect((u4[0] as { t: string }).t).toBe("acme");
    expect((u3again[0] as { u: string }).u).toBe("alice");
  });

  test(
    "sweep concurrency × bind shapes",
    async () => {
      const points: PointResult[] = [];
      for (const n of CONCURRENCY) {
        for (const [shape, handle] of [
          ["binds3", asUser3],
          ["binds4", asUser4],
        ] as const) {
          const { latencies, opsPerSec } = await sweepPoint(handle, n, ROUNDS);
          const s = summarize(latencies);
          const maxMs = Number(Math.max(...latencies).toFixed(3));
          points.push({
            n,
            shape,
            p50Ms: s.p50Ms,
            p99Ms: s.p99Ms,
            maxMs,
            opsPerSec: Number(opsPerSec.toFixed(1)),
          });
        }
      }

      // Report + issue detection: super-linear collapse = queue physics broken.
      const issues: string[] = [];
      for (const shape of ["binds3", "binds4"] as const) {
        const pts = points.filter((p) => p.shape === shape);
        for (let i = 1; i < pts.length; i += 1) {
          const prev = pts[i - 1]!;
          const cur = pts[i]!;
          const nRatio = cur.n / prev.n;
          const p50Ratio = cur.p50Ms / Math.max(prev.p50Ms, 0.001);
          if (p50Ratio > nRatio * 2.5) {
            issues.push(
              `super-linear collapse at N=${cur.n} (${shape}): p50 grew ${p50Ratio.toFixed(1)}x for ${nRatio.toFixed(1)}x concurrency`,
            );
          }
        }
      }

      console.log("[G1] points:", JSON.stringify(points));
      if (issues.length > 0) console.warn("[G1] ISSUES:", issues);

      const metrics: Record<string, number> = {};
      for (const p of points) {
        metrics[`n${p.n}.${p.shape}.p50Ms`] = p.p50Ms;
        metrics[`n${p.n}.${p.shape}.p99Ms`] = p.p99Ms;
        metrics[`n${p.n}.${p.shape}.maxMs`] = p.maxMs;
        metrics[`n${p.n}.${p.shape}.opsPerSec`] = p.opsPerSec;
      }

      const path = await writeArtifact({
        group: "G1",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: CAL
          ? "OKE_BENCH=1 OKE_BENCH_CAL=1 bun test src/bench/g01-rls-stamp.bench.ts --timeout 120000"
          : "OKE_BENCH=1 bun test src/bench/g01-rls-stamp.bench.ts --timeout 120000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G1] artifact: ${path}`);
      expect(points.length).toBe(CONCURRENCY.length * 2);
    },
    CAL ? 60_000 : 120_000,
  );
});
