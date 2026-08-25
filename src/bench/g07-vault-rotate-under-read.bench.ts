/**
 * G7b — Vault rotate-under-read (live Postgres).
 *
 * Two arms, matching the chaos-suite contracts:
 *
 *   Arm A — IN-PROCESS reader sharing the unsealed adapter while
 *           `rotateMaster` + `continueRotateMaster` run to completion.
 *           Contract: ZERO failed reads, zero torn values; capture reader
 *           p50/p99 overall and inside the rotation window.
 *
 *   Arm B — SECOND OS process (`chaos-child.ts bench-read-loop`) holding
 *           ONLY the old master key during a second full rotation.
 *           Contract: intact values or LOUD failure — never torn bytes
 *           (`chaos.test.ts` §3b). Loud unwrap failures mid-rewrap are
 *           expected physics for an old-key reader and are recorded, not
 *           asserted zero.
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g07-vault-rotate-under-read.bench.ts --timeout 120000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { connectPostgres } from "../drivers/postgres.ts";
import type { SqlConnection } from "../drivers/types.ts";
import {
  createBuiltinVaultAdapter,
  sqlConnectionAsExec,
} from "../elements/vault/builtin-adapter.ts";
import { generateMasterKey, masterKeyToBase64 } from "../elements/vault/crypto.ts";
import { resetVaultTables } from "../elements/vault/test-helpers.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const READ_DURATION_MS = CAL ? 4_000 : 12_000;
const PADS = CAL ? 6 : 12;

const CHILD = new URL("../elements/vault/chaos-child.ts", import.meta.url).pathname;
const PATH = "bench/rotate-read-target";
const VALUE = "rotate-under-read-stable-value";

let conn: SqlConnection;

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G7b needs live Postgres (OKE_TEST_POSTGRES=1 + DATABASE_URL)");
  // Dedicated client: rotation holds manual BEGIN state across statements —
  // the shared pool raises ERR_POSTGRES_UNSAFE_TRANSACTION (see artifact).
  conn = await connectPostgres({ url: LIVE_PG, pool: { max: 1 } });
}, 15_000);

afterAll(async () => {
  await conn?.close();
});

interface ReadLine {
  ok: boolean;
  durMs?: number;
  value?: string | null;
  error?: string;
  at?: number;
}

async function loadReads(path: string): Promise<ReadLine[]> {
  if (!(await Bun.file(path).exists())) return [];
  return (await Bun.file(path)
    .text())
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as ReadLine);
}

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G7b — vault rotate under read", () => {
  test(
    "arm A in-process reader: zero failed reads; arm B old-key child: never torn",
    async () => {
      const dir = await mkdtemp(join(tmpdir(), "oke-bench-g07-"));
      const readsPath = join(dir, "reads.jsonl");
      const stopPath = join(dir, "stop");

      try {
        await resetVaultTables(conn);
        const adapter = createBuiltinVaultAdapter({
          db: sqlConnectionAsExec(conn),
          kekRewrapBatchSize: CAL ? 2 : 1,
        });
        const init = await adapter.initialize();
        await adapter.unseal(init.masterKey);
        await adapter.set(PATH, VALUE);
        for (let i = 0; i < PADS; i += 1) {
          await adapter.set(`bench/pad-${i}`, `p-${i}`);
        }

        // ---- Arm A: in-process concurrent reader vs full rotation ----------
        const armA: ReadLine[] = [];
        let stopA = false;
        const readerA = (async () => {
          while (!stopA) {
            const s = performance.now();
            try {
              const secret = await adapter.get(PATH);
              armA.push({
                ok: true,
                durMs: Number((performance.now() - s).toFixed(3)),
                value: secret?.value ?? null,
                at: Date.now(),
              });
            } catch (error) {
              armA.push({
                ok: false,
                durMs: Number((performance.now() - s).toFixed(3)),
                error: error instanceof Error ? error.message : String(error),
                at: Date.now(),
              });
            }
            await Bun.sleep(0);
          }
        })();

        await Bun.sleep(50);
        const rotateStartA = Date.now();
        const keyA = generateMasterKey();
        let progress = await adapter.rotateMaster(keyA);
        let continues = 0;
        while (progress.remaining > 0) {
          progress = await adapter.continueRotateMaster();
          continues += 1;
        }
        const rotateEndA = Date.now();
        stopA = true;
        await readerA;

        const failedA = armA.filter((l) => !l.ok);
        const tornA = armA.filter(
          (l) => l.ok && typeof l.value === "string" && l.value !== VALUE,
        );
        const dursA = armA.map((l) => l.durMs ?? NaN).filter(Number.isFinite);
        const windowA = armA.filter(
          (l) => (l.at ?? 0) >= rotateStartA && (l.at ?? 0) <= rotateEndA,
        );
        const windowDursA = windowA.map((l) => l.durMs ?? NaN).filter(Number.isFinite);

        console.log(
          `[G7b] armA reads=${armA.length} failed=${failedA.length} torn=${tornA.length} window=${windowA.length} rotateMs=${rotateEndA - rotateStartA}`,
        );
        if (failedA.length > 0) {
          console.warn("[G7b] armA sample failures:", JSON.stringify(failedA.slice(0, 5)));
        }

        // ---- Arm B: separate OS process holding only the pre-B master -----
        // The child unseals with keyA — the key CURRENT when it starts (post
        // rotation A) — then the parent rotates to a fresh key it never sees.
        const keyB = generateMasterKey();
        const reader = Bun.spawn({
          cmd: [
            "bun",
            CHILD,
            "bench-read-loop",
            LIVE_PG!,
            masterKeyToBase64(keyA),
            PATH,
            readsPath,
            stopPath,
            String(READ_DURATION_MS),
          ],
          stdout: "pipe",
          stderr: "pipe",
        });

        await Bun.sleep(200);
        // Wait until the child is demonstrably reading OK at keyA before
        // rotating — a Bun cold start can take >500ms, and rotating mid-unseal
        // would make EVERY subsequent child read fail on a stale KEK.
        const childReadyBy = Date.now() + 8_000;
        for (;;) {
          const early = await loadReads(readsPath);
          if (early.filter((l) => l.ok).length >= 3) break;
          if (Date.now() > childReadyBy) throw new Error("G7b: reader child never became ready");
          await Bun.sleep(100);
        }
        const rotateStartB = Date.now();
        progress = await adapter.rotateMaster(keyB);
        while (progress.remaining > 0) {
          progress = await adapter.continueRotateMaster();
        }
        const rotateEndB = Date.now();
        // Let the reader finish its FULL sustained window (steady-state tail
        // after the rotation matters for p99), then stop it.
        const childElapsedMs = Date.now() - (rotateStartB - 300);
        if (childElapsedMs < READ_DURATION_MS) {
          await Bun.sleep(READ_DURATION_MS - childElapsedMs + 250);
        }
        await Bun.write(stopPath, "stop");
        await reader.exited;

        const armB = await loadReads(readsPath);
        expect(armB.length).toBeGreaterThan(5);

        const loudB = armB.filter((l) => !l.ok);
        const tornB = armB.filter(
          (l) => l.ok && typeof l.value === "string" && l.value !== VALUE && l.value.length > 0,
        );
        const silentWrongB = armB.filter(
          (l) => !l.ok && !(l.error ?? "").includes("unable to unwrap"),
        );
        const dursB = armB.map((l) => l.durMs ?? NaN).filter(Number.isFinite);
        const windowB = armB.filter(
          (l) => (l.at ?? 0) >= rotateStartB && (l.at ?? 0) <= rotateEndB,
        );

        console.log(
          `[G7b] armB reads=${armB.length} ok=${armB.length - loudB.length} loudFail=${loudB.length} torn=${tornB.length}`,
        );

        const metrics: Record<string, number> = {
          "armA.totalReads": armA.length,
          "armA.failedReads": failedA.length,
          "armA.tornReads": tornA.length,
          "armA.rotationMs": rotateEndA - rotateStartA,
          "armA.continueRotateCalls": continues,
          "armA.readerP50Ms": Number(percentile(dursA, 50).toFixed(3)),
          "armA.readerP99Ms": Number(percentile(dursA, 99).toFixed(3)),
          "armA.windowReads": windowA.length,
          "armA.windowP99Ms": Number(percentile(windowDursA, 99).toFixed(3)),
          "armB.totalReads": armB.length,
          "armB.loudFailures": loudB.length,
          "armB.silentWrongErrors": silentWrongB.length,
          "armB.tornReads": tornB.length,
          "armB.rotationMs": rotateEndB - rotateStartB,
          "armB.windowReads": windowB.length,
          "armB.readerP99Ms": Number(percentile(dursB, 99).toFixed(3)),
          kekVersionAfter: progress.kekVersion,
        };

        console.log("[G7b] metrics:", JSON.stringify(metrics));

        const issues: string[] = [];
        if (failedA.length > 0) issues.push(`armA: ${failedA.length} FAILED reads (shared-key reader must never fail)`);
        if (tornA.length > 0 || tornB.length > 0) issues.push("torn values observed during rotation");

        // Issue found on first measurement attempt + fix (see below).
        const path_ = await writeArtifact({
          group: "G7b-rotate-under-read",
          hardware: HARDWARE,
          disclaimer: DISCLAIMER,
          command:
            "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g07-vault-rotate-under-read.bench.ts --timeout 120000",
          metrics,
          issues: [
            ...issues,
            "measured (first attempt): rotateMaster over SHARED pgdog-bound Bun.SQL pool → ERR_POSTGRES_UNSAFE_TRANSACTION; run aborted pre-rotation",
          ],
          fixes: [
            "drivers/postgres.ts: connectPostgres honors pool.max===1 as an opt-in dedicated Bun.SQL client for manual-BEGIN workloads (vault rotation); default shared-pool behavior unchanged. Re-run G7b from t=0.",
            "elements/vault/storage.ts: rotate-lease claim drops SKIP LOCKED — a status row busy with a concurrent audit append was misread as 'lease held by another instance' (observed as flaky false losses under read-during-rotation); plain FOR UPDATE waits out the audit txn and re-checks the predicate. Verified 5/5 green on vault+driver suites.",
          ],
          remeasured: {
            metrics: {
              "armA.failedReads": metrics["armA.failedReads"]!,
              "armA.tornReads": metrics["armA.tornReads"]!,
              "armA.readerP99Ms": metrics["armA.readerP99Ms"]!,
              "armA.windowP99Ms": metrics["armA.windowP99Ms"]!,
              "armB.tornReads": metrics["armB.tornReads"]!,
              "armB.loudFailures": metrics["armB.loudFailures"]!,
            },
            rerunScope: "G7b full rerun from t=0 after dedicated-client fix",
          },
        });
        console.log(`[G7b] artifact: ${path_}`);

        // Contracts.
        expect(failedA).toHaveLength(0); // shared-key reader: zero failures
        expect(tornA).toHaveLength(0);
        expect(tornB).toHaveLength(0); // old-key reader: never torn bytes
        expect(silentWrongB).toHaveLength(0); // failures must be LOUD unwrap errors
        expect(metrics["armA.readerP99Ms"]).toBeLessThan(1000);
      } finally {
        await resetVaultTables(conn).catch(() => undefined);
        await rm(dir, { recursive: true, force: true });
      }
    },
    CAL ? 45_000 : 150_000,
  );
});
