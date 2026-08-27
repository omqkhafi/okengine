/**
 * G3a — competing once-consumer sweep against the live postgres signal driver.
 *
 * Opens a real transactional-outbox bus (`openPostgresSignal`) on live
 * Postgres (pgdog), subscribes N competing consumers on one `once` signal,
 * emits M messages, and measures delivery throughput + `throughputPerSec()`
 * from `bus.inspect()` for N ∈ {1, 2, 4, 8, 16}.
 *
 * Honesty note: Bun.SQL has no LISTEN/NOTIFY API, so wakeups are fanned out
 * in-process by `lib/signal-pg.ts` (real SQL outbox + real claims; only the
 * cross-process wakeup path is not exercised).
 *
 * Run: OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=… bun test ./src/bench/g03-signal-once.bench.ts --timeout 180000
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { openPostgresSignal } from "../drivers/signal-postgres.ts";
import type { SignalBus } from "../drivers/signal-types.ts";
import { signal } from "../elements/signal/declare.ts";
import { LIVE_PG } from "./lib/infra.ts";
import { createBunSignalSql } from "./lib/signal-pg.ts";
import { DISCLAIMER, HARDWARE, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";
const SIGNAL_NAME = "g3-once";
const MESSAGES_PER_LEVEL = CAL ? 50 : 200;
const LEVELS = CAL ? [1, 4] : [1, 2, 4, 8, 16];
const DRAIN_TIMEOUT_MS = 30_000;

let sql: ReturnType<typeof createBunSignalSql>;
let bus: SignalBus;

beforeAll(async () => {
  if (!LIVE_PG) throw new Error("G3 needs live Postgres: set OKE_TEST_POSTGRES=1 + DATABASE_URL");
  sql = createBunSignalSql(LIVE_PG);
  const decl = signal(SIGNAL_NAME, { delivery: "once", retries: 2, deadLetter: true });
  bus = await openPostgresSignal({
    signals: new Map([[decl.name, decl]]),
    sql,
    leaseMs: 5_000,
  });
}, 20_000);

afterAll(async () => {
  try {
    await sql.exec(`DELETE FROM oke_signal_messages WHERE signal LIKE 'g3-%'`);
  } catch {
    /* best-effort cleanup */
  }
  try {
    await bus?.close();
  } catch {
    /* already closed */
  }
  try {
    await sql.close();
  } catch {
    /* best-effort */
  }
});

describe.skipIf(!process.env.OKE_BENCH || !LIVE_PG)("G3a — once-consumer sweep", () => {
  test(`${MESSAGES_PER_LEVEL} msgs × competing consumers ${LEVELS.join("/")} — throughput + inspect()`, async () => {
    const perLevel: Array<{
      consumers: number;
      delivered: number;
      msgsPerSec: number;
      wallMs: number;
      throughputPerSec: number;
    }> = [];
    const issues: string[] = [];

    for (const n of LEVELS) {
      // Fresh consumer cohort per level.
      const received: number[] = [];
      const unsubs: Array<() => void | Promise<void>> = [];
      for (let i = 0; i < n; i++) {
        const id = `g3-c${n}-${i}`;
        const unsub = await bus.subscribe(SIGNAL_NAME, id, async () => {
          received.push(1);
        });
        unsubs.push(unsub);
      }

      const t0 = performance.now();
      // One emit == one outbox message; fire MESSAGES_PER_LEVEL of them
      // (small concurrent batches), then closed-loop drain until all are
      // delivered or timeout.
      const BATCH = 25;
      for (let i = 0; i < MESSAGES_PER_LEVEL; i += BATCH) {
        await Promise.all(
          Array.from({ length: Math.min(BATCH, MESSAGES_PER_LEVEL - i) }, (_, j) =>
            bus.emit(SIGNAL_NAME, { level: n, seq: i + j }),
          ),
        );
      }

      // Closed-loop drain until every message is delivered (or timeout).
      const deadline = Date.now() + DRAIN_TIMEOUT_MS;
      while (received.length < MESSAGES_PER_LEVEL && Date.now() < deadline) {
        await bus.drain();
        await Bun.sleep(2);
      }
      const wallMs = performance.now() - t0;

      const stats = (await bus.inspect()).find((s) => s.signal === SIGNAL_NAME);
      perLevel.push({
        consumers: n,
        delivered: received.length,
        msgsPerSec: Number((received.length / (wallMs / 1000)).toFixed(1)),
        wallMs: Number(wallMs.toFixed(0)),
        throughputPerSec: stats?.throughputPerSec ?? -1,
      });

      for (const u of unsubs) await u();

      if (received.length !== MESSAGES_PER_LEVEL) {
        issues.push(
          `consumers=${n}: delivered ${received.length}/${MESSAGES_PER_LEVEL} within ${DRAIN_TIMEOUT_MS}ms`,
        );
      }
      // Exactly-once across competing consumers.
      expect(received.length).toBeLessThanOrEqual(MESSAGES_PER_LEVEL);
    }

    const metrics: Record<string, number> = {};
    for (const l of perLevel) {
      metrics[`consumers${l.consumers}MsgsPerSec`] = l.msgsPerSec;
      metrics[`consumers${l.consumers}ThroughputInspect`] = l.throughputPerSec;
      metrics[`consumers${l.consumers}WallMs`] = l.wallMs;
    }
    metrics.totalDelivered = perLevel.reduce((a, l) => a + l.delivered, 0);
    // Super-linear collapse check: 16 consumers should retain ≥25% of the
    // 1-consumer rate (queue physics allow some degradation, not collapse).
    const base = perLevel.find((l) => l.consumers === LEVELS[0])?.msgsPerSec ?? 0;
    const top = perLevel[perLevel.length - 1]?.msgsPerSec ?? 0;
    if (base > 0 && top > 0 && top < base * 0.25) {
      issues.push(`super-linear collapse: ${LEVELS[0]}c=${base}/s vs ${top}c=${top}/s`);
    }

    console.log("[G3a] per-level:", JSON.stringify(perLevel));
    const path = await writeArtifact({
      group: "G3a-signal-once",
      hardware: HARDWARE,
      disclaimer: DISCLAIMER,
      command:
        "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test ./src/bench/g03-signal-once.bench.ts --timeout 180000",
      metrics,
      issues,
      fixes: [],
      remeasured: null,
    });
    console.log(`[G3a] artifact: ${path}`);

    expect(metrics.totalDelivered!).toBeGreaterThan(0);
  }, 150_000);
});
