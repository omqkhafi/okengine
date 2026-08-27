/**
 * G9 — durable journal / fx.step sustained (live Postgres via pgdog).
 *
 * Boots a real `oke()` app whose journal runtime is `createPostgresJournalStore`
 * (the SKIP LOCKED claim/lease path), then drives parallel durable flow
 * executions closed-loop for `OKE_BENCH_DURATION_S` seconds (default 300).
 * Every run records 3 journaled steps; `store.put` is wrapped with a counter
 * so journal write rate is exact. A background sampler tracks backlog depth
 * (`running`/`sleeping` runs) every 5 s.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g09-journal-sustained.bench.ts --timeout 420000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createPostgresJournalStore } from "../drivers/journal-postgres.ts";
import { oke, type OkeApp } from "../kernel/app.ts";
import type { JournalRuntime } from "../kernel/boot-bind/journal.ts";
import { flow, type AnyFlowDef } from "../kernel/flow.ts";
import type { Binding } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import type { JournalRun, JournalStore } from "../kernel/journal.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const DURATION_S = CAL ? 15 : Math.max(10, Number(process.env.OKE_BENCH_DURATION_S ?? "300"));
/** Closed-loop workers — each awaits run completion before firing again. */
const CONCURRENCY = CAL ? 4 : 16;
const FLOW_PREFIX = "g9sustained";

let app: OkeApp;
let journal: Awaited<ReturnType<typeof createPostgresJournalStore>>;
let putsCount = 0;
let stepRuns = 0;
let failedRuns = 0;

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G9 needs live Postgres: set OKE_TEST_POSTGRES=1 + DATABASE_URL");
  journal = await createPostgresJournalStore({ url: LIVE_PG });
  await journal.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE '${FLOW_PREFIX}%'`);

  // Exact journal write accounting: wrap put().
  const counted = {
    ...journal,
    put: async (run: JournalRun) => {
      putsCount += 1;
      await journal.put(run);
    },
  } as JournalStore & NonNullable<JournalRuntime["store"]>;
  const jrt: JournalRuntime = {
    store: counted,
    instanceId: "g9-bench",
    leaseMs: 30_000,
    driverId: "postgres",
  };

  // Three lightweight fx.steps per run — replay never re-runs them.
  const work = flow(`${FLOW_PREFIX}.work`, {
    durable: true,
    do: async (input, fx) => {
      const n = Number((input as { n?: number }).n ?? 0);
      const a = await fx.step("step-a", () => n + 1);
      const b = await fx.step("step-b", async () => a * 2);
      await fx.step("step-c", () => ({ b, at: Date.now() }));
      stepRuns += 3;
      return { ok: true as const, b };
    },
  });
  const bindings: Binding[] = [
    { trigger: http.post("/g9/work").public(), flow: work as AnyFlowDef },
  ];
  app = oke({
    name: "g9-journal-sustained",
    env: "test",
    startScheduler: false,
    gate: { unguardedHttp: "allow" },
    bindings,
    elements: { journal: jrt },
  });
  await app.boot();
}, 30_000);

afterAll(async () => {
  try {
    await journal?.sql.exec(`DELETE FROM oke_journal_runs WHERE flow LIKE '${FLOW_PREFIX}%'`);
    await journal?.close();
  } catch {
    /* best-effort cleanup */
  }
});

interface BacklogSample {
  tS: number;
  backlog: number;
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G9 — journal sustained", () => {
  test(
    `${DURATION_S}s of parallel durable flows — steps/sec, write rate, backlog depth`,
    async () => {
      const samples: BacklogSample[] = [];
      let sampling = true;
      const t0 = performance.now();
      const sampler = (async () => {
        while (sampling) {
          try {
            const rows = await journal.sql.query(
              `SELECT COUNT(*) AS c FROM oke_journal_runs
               WHERE flow LIKE ? AND status IN ('running','sleeping','compensating')`,
              [`${FLOW_PREFIX}%`],
            );
            samples.push({
              tS: Number(((performance.now() - t0) / 1000).toFixed(1)),
              backlog: Number((rows[0] as { c: number }).c),
            });
          } catch {
            /* sampler is best-effort */
          }
          await Bun.sleep(5_000);
        }
      })();

      const latencies: number[] = [];
      let done = 0;
      const deadlineMs = DURATION_S * 1000;

      const worker = async (): Promise<void> => {
        for (;;) {
          if (performance.now() - t0 >= deadlineMs) return;
          const s = performance.now();
          try {
            const res = await app.fetch(
              new Request("http://localhost/g9/work", {
                method: "POST",
                body: JSON.stringify({ n: done }),
                headers: { "content-type": "application/json" },
              }),
            );
            if (!res.ok) throw new Error(`g9 work HTTP ${res.status}`);
          } catch {
            failedRuns += 1;
            continue;
          }
          latencies.push(performance.now() - s);
          done += 1;
        }
      };

      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      const wallS = (performance.now() - t0) / 1000;
      sampling = false;
      await sampler;

      const metrics: Record<string, number> = {
        durationS: Number(wallS.toFixed(1)),
        concurrency: CONCURRENCY,
        runsCompleted: done,
        runsPerSec: Number((done / wallS).toFixed(2)),
        stepsExecuted: stepRuns,
        stepsPerSec: Number((stepRuns / wallS).toFixed(2)),
        journalPuts: putsCount,
        journalWritesPerSec: Number((putsCount / wallS).toFixed(2)),
        runP50Ms: Number(percentile(latencies, 50).toFixed(3)),
        runP99Ms: Number(percentile(latencies, 99).toFixed(3)),
        runMaxMs: latencies.length ? Number(Math.max(...latencies).toFixed(3)) : 0,
        failedRuns,
        backlogMax: samples.length ? Math.max(...samples.map((x) => x.backlog)) : -1,
        backlogAvg:
          samples.length > 0
            ? Number((samples.reduce((a, x) => a + x.backlog, 0) / samples.length).toFixed(2))
            : -1,
        backlogFinal: samples.length ? samples[samples.length - 1]!.backlog : -1,
      };

      console.log("[G9] metrics:", JSON.stringify(metrics));
      const issues: string[] = [];
      if (failedRuns > 0) issues.push(`failed durable runs under sustained load: ${failedRuns}`);
      if (metrics.backlogFinal! > CONCURRENCY * 2) {
        issues.push(
          `backlog did not drain: final=${metrics.backlogFinal} vs concurrency=${CONCURRENCY}`,
        );
      }

      const path = await writeArtifact({
        group: "G9",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g09-journal-sustained.bench.ts --timeout 420000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G9] artifact: ${path}`);

      expect(failedRuns).toBe(0);
      expect(done).toBeGreaterThan(0);
      expect(stepRuns).toBe(done * 3);
    },
    CAL ? 120_000 : Math.min(600_000, DURATION_S * 1000 + 120_000),
  );
});
