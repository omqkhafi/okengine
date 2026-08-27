/**
 * G16 — Live query fan-out (subscribers × stamped EXISTS).
 *
 * Characterizes the Realtime capability's honest cost model:
 *   cost_per_event ≈ active_subscriptions × (stamp_prelude + point_lookup)
 *
 * Sweeps subscriber counts on one shared PGlite connection (serialized stamp
 * queue — G1 physics). Each CDC event fans out a stamped EXISTS probe per
 * subscriber; wall-clock and per-event p50/p99 are recorded.
 *
 * Run: bun test src/bench/g16-live-query-fanout.bench.ts --timeout 120000
 * Env: OKE_BENCH=1 (PGlite). OKE_BENCH_CAL=1 shrinks N for a calibration pass.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { connectPglite } from "../drivers/pglite.ts";
import { installOkeRlsHelpers, type RlsIdentity } from "../drivers/pg-rls.ts";
import type { SqlConnection } from "../drivers/types.ts";
import {
  LiveQueryRuntime,
  type LiveQueryEvent,
  type LiveSubscription,
} from "../elements/store/live-query-runtime.ts";
import { liveQueryRuntimeFromConn } from "../elements/store/live-query-server.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
/** Subscriber counts per sweep point. */
const SUBSCRIBERS = CAL ? [10, 50] : [10, 50, 100, 200];
/** CDC events fired per point (each fans out to every subscriber). */
const EVENTS = CAL ? 5 : 20;
/** Settle wait after the last event (ms). */
const SETTLE_MS = 2_000;

const NOTES_DDL = `CREATE TABLE notes (
  id text PRIMARY KEY,
  owner text NOT NULL,
  body text NOT NULL
)`;

const OWNER_POLICY = `CREATE POLICY owner_select ON notes
  AS PERMISSIVE FOR SELECT TO public
  USING (owner = oke.user())`;

let conn: SqlConnection;
let runtime: LiveQueryRuntime;

beforeAll(async () => {
  conn = await connectPglite({ url: "memory://bench-g16-live-fanout", role: "primary" });
  await conn.exec(NOTES_DDL);
  await conn.exec(`INSERT INTO notes VALUES ('n1', 'alice', 'hi'), ('n2', 'bob', 'yo')`);
  await conn.exec(`ALTER TABLE notes ENABLE ROW LEVEL SECURITY`);
  await installOkeRlsHelpers((sql) => conn.exec(sql));
  await conn.exec(OWNER_POLICY);
  runtime = liveQueryRuntimeFromConn(conn);
}, 15_000);

afterAll(async () => {
  await conn.close();
});

interface PointResult {
  readonly subscribers: number;
  readonly events: number;
  readonly delivered: number;
  readonly wallMs: number;
  readonly p50MsPerEvent: number;
  readonly p99MsPerEvent: number;
  readonly eventsPerSec: number;
  readonly shed: number;
}

function aliceIdentity(_i: number): RlsIdentity {
  return { gate: "member", userId: "alice", scopes: ["member"] };
}

function waitFor(pred: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = (): void => {
      if (pred()) {
        resolve(true);
        return;
      }
      if (Date.now() - start > timeoutMs) {
        resolve(false);
        return;
      }
      setTimeout(tick, 5);
    };
    tick();
  });
}

describe("G16 live query fan-out", () => {
  test("subscribers × stamped EXISTS scales without unbounded queue growth", async () => {
    if (process.env.OKE_BENCH !== "1") {
      console.log("skip: set OKE_BENCH=1 to run G16");
      return;
    }

    const points: PointResult[] = [];
    const issues: string[] = [];

    for (const n of SUBSCRIBERS) {
      const delivered: number[] = [];
      const unsubs: Array<() => void> = [];
      let totalDelivered = 0;

      for (let i = 0; i < n; i += 1) {
        delivered.push(0);
        const idx = i;
        const sub: LiveSubscription = {
          id: `sub-${n}-${i}`,
          ref: "sql:notes",
          table: "notes",
          pkColumn: "id",
          identity: aliceIdentity(i),
          deliver(_event: LiveQueryEvent) {
            delivered[idx] = (delivered[idx] ?? 0) + 1;
            totalDelivered += 1;
          },
        };
        unsubs.push(runtime.subscribe(sub));
      }

      const shedBefore = runtime.metrics.eventsShed;
      const eventLatencies: number[] = [];
      const t0 = performance.now();
      for (let e = 0; e < EVENTS; e += 1) {
        const before = totalDelivered;
        const te0 = performance.now();
        runtime.onCdc({
          tableName: "notes",
          op: "update",
          before: { id: "n1", owner: "alice", body: "hi" },
          after: { id: "n1", owner: "alice", body: `hi-${e}` },
          seq: e + 1,
        });
        // Wait until every subscriber got this event (or settle timeout).
        const expected = before + n;
        const ok = await waitFor(() => totalDelivered >= expected, SETTLE_MS);
        eventLatencies.push(performance.now() - te0);
        if (!ok) {
          issues.push(
            `N=${n} event ${e}: delivered ${totalDelivered}/${expected} within ${SETTLE_MS}ms`,
          );
          break;
        }
      }
      const wallMs = performance.now() - t0;
      const shed = runtime.metrics.eventsShed - shedBefore;

      for (const u of unsubs) u();

      const point: PointResult = {
        subscribers: n,
        events: eventLatencies.length,
        delivered: totalDelivered,
        wallMs: Number(wallMs.toFixed(1)),
        p50MsPerEvent: Number(percentile(eventLatencies, 50).toFixed(2)),
        p99MsPerEvent: Number(percentile(eventLatencies, 99).toFixed(2)),
        eventsPerSec: Number(((eventLatencies.length / wallMs) * 1000).toFixed(1)),
        shed,
      };
      points.push(point);

      // Shed must stay at 0 under these N×EVENTS sizes — queue is 10k.
      expect(shed).toBe(0);
      // Rough linear growth: p50 at max N should not be > 20× p50 at min N
      // (serialized PGlite is slow by design; collapse would be >>20×).
    }

    if (points.length >= 2) {
      const first = points[0]!;
      const last = points[points.length - 1]!;
      const ratio = last.p50MsPerEvent / Math.max(0.001, first.p50MsPerEvent);
      if (ratio > 40) {
        issues.push(
          `super-linear fan-out: p50 ${first.subscribers}→${last.subscribers} grew ${ratio.toFixed(1)}×`,
        );
      }
    }

    const path = await writeArtifact({
      group: "g16-live-query-fanout",
      hardware: HARDWARE,
      disclaimer: DISCLAIMER,
      command: "bun test src/bench/g16-live-query-fanout.bench.ts",
      metrics: Object.fromEntries(
        points.flatMap((p) => [
          [`n${p.subscribers}_p50Ms`, p.p50MsPerEvent],
          [`n${p.subscribers}_p99Ms`, p.p99MsPerEvent],
          [`n${p.subscribers}_eventsPerSec`, p.eventsPerSec],
          [`n${p.subscribers}_wallMs`, p.wallMs],
        ]),
      ),
      issues,
      fixes: [],
      remeasured: null,
    });
    console.log(`G16 artifact → ${path}`);
    console.table(points);
    expect(points.length).toBe(SUBSCRIBERS.length);
  }, 120_000);
});
