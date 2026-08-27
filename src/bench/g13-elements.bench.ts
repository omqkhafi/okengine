/**
 * G13 — remaining elements (one file, four sub-benchmarks):
 *
 *   a. Gate.rate `takeRate` at high RPS against live Redis (EVAL Lua).
 *   b. Cumulative `gated()` cost — capability assert + effect ledger per call
 *      through the stub-store path, swept 1k → 10k → 50k ops.
 *   c. Concurrent `fx.json.stream` through `encodeSseStream` (mock AI driver).
 *   d. Channel bulk send via RetryTransport → Mailpit SMTP
 *      (skips loudly when Mailpit is absent).
 *
 * Run: OKE_BENCH=1 bun test ./src/bench/g13-elements.bench.ts --timeout 300000
 */

import { afterAll, describe, expect, test } from "bun:test";
import { openSmtpChannel } from "../drivers/channel-smtp.ts";
import { openRedisKv } from "../drivers/redis.ts";
import type { KvNamespace } from "../drivers/types.ts";
import { channel } from "../elements/channel.ts";
import { createChannelRuntime, type TemplateCatalog } from "../elements/channel/runtime.ts";
import { takeRate } from "../elements/gate/strategies.ts";
import { ai } from "../elements/ai.ts";
import type { AiDriver } from "../drivers/ai-types.ts";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq, type AnyFlowDef } from "../kernel/flow.ts";
import { on, resetBindings, type Binding } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { LIVE_REDIS } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const CAL = process.env.OKE_BENCH_CAL === "1";

// --- Mailpit probe ------------------------------------------------------------
const MAILPIT_HOST = process.env.OKE_BENCH_MAILPIT_HOST?.trim() || "127.0.0.1";
const MAILPIT_SMTP_PORT = Number(process.env.OKE_BENCH_MAILPIT_PORT ?? "20850");
const MAILPIT_UI = process.env.OKE_BENCH_MAILPIT_UI?.trim() || "http://127.0.0.1:21850";

async function probeMailpit(): Promise<boolean> {
  // Bun.connect needs a socket handler; the Mailpit UI is the reliable
  // liveness probe (SMTP + UI ship together).
  try {
    const res = await fetch(`${MAILPIT_UI}/api/v1/messages?limit=1`, {
      signal: AbortSignal.timeout(2_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

describe.skipIf(!process.env.OKE_BENCH)("G13 — remaining elements", () => {
  // ---------------------------------------------------------------- a. takeRate
  const HAVE_REDIS = Boolean(LIVE_REDIS);
  test.skipIf(!HAVE_REDIS)(
    "gate takeRate at high RPS (live redis EVAL)",
    async () => {
      const kv: KvNamespace & { eval?: unknown } = await openRedisKv({
        name: "bench-g13-gate",
        url: LIVE_REDIS!,
      });
      // Deterministic window so takes never fight refill noise.
      const nowMs = 1_700_000_000_000;
      const subjects = Array.from({ length: CAL ? 5 : 50 }, (_, i) => `s${i}`);
      const TAKES = CAL ? 500 : 10_000;
      const takesPerSubject = TAKES / subjects.length;
      // Half the per-subject takes fit the bucket — exercises allow AND deny.
      const MAX = Math.max(1, Math.floor(takesPerSubject / 2));

      const latencies: number[] = [];
      let allowed = 0;
      const t0 = performance.now();
      await Promise.all(
        subjects.map(async (subject) => {
          for (let i = 0; i < takesPerSubject; i++) {
            const s = performance.now();
            const r = await takeRate(kv, {
              strategy: "token-bucket",
              max: MAX,
              windowMs: 60_000,
              subject: `g13:${subject}`,
              nowMs,
            });
            latencies.push(performance.now() - s);
            if (r.allowed) allowed += 1;
          }
        }),
      );
      const wallS = (performance.now() - t0) / 1000;
      const metrics: Record<string, number> = {
        takes: latencies.length,
        takesPerSec: Number((latencies.length / wallS).toFixed(1)),
        p50Ms: Number(percentile(latencies, 50).toFixed(3)),
        p99Ms: Number(percentile(latencies, 99).toFixed(3)),
        bucketMax: MAX,
        allowedWithinBucket: allowed,
        deniedAfterBucketExhausted: latencies.length - allowed,
      };
      console.log("[G13a] metrics:", JSON.stringify(metrics));

      // Correctness: deterministic clock + max per subject → exactly MAX
      // allows per subject, everything after denied.
      expect(allowed).toBe(MAX * subjects.length);

      const issues: string[] = [];
      if (metrics.takesPerSec! < 200)
        issues.push(`takeRate throughput low: ${metrics.takesPerSec}/s`);

      const path = await writeArtifact({
        group: "G13a",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_REDIS_URL=$OKE_TEST_REDIS_URL bun test ./src/bench/g13-elements.bench.ts --timeout 300000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G13a] artifact: ${path}`);
      expect(issues.length).toBe(0);
    },
    CAL ? 60_000 : 180_000,
  );

  // ------------------------------------------------------------- b. gated() cost
  test(
    "gated() cumulative cost — 1k/10k/50k capability+ledger calls",
    async () => {
      resetBindings();
      resetFlowSeq();

      let reportedUs = 0;
      // Every stub-store op routes through gated("read"/"write"):
      // capability.assert + effect ledger per call.
      const gatedBench = flow("g13.gated", {
        do: async (input, fx) => {
          const n = Math.max(1, Math.min(100_000, Number((input as { n?: number }).n ?? 1)));
          const store = fx.store(`kv:g13cost` as never) as unknown as {
            set(key: string, value: number): Promise<void>;
            get(key: string): Promise<unknown>;
          };
          const t0 = performance.now();
          for (let i = 0; i < n; i++) {
            await store.set(`k${i}`, i);
          }
          for (let i = 0; i < n; i++) {
            await store.get(`k${i}`);
          }
          reportedUs = Number(((performance.now() - t0) * 1000).toFixed(3));
          return { us: reportedUs, n };
        },
      });

      const bindings: Binding[] = [
        { trigger: http.post("/g13/gated").public(), flow: gatedBench as AnyFlowDef },
      ];
      const app13b = oke({
        name: "g13-gated-cost",
        env: "test",
        startScheduler: false,
        gate: { unguardedHttp: "allow" },
        bindings,
      });

      const metrics: Record<string, number> = {};
      for (const n of CAL ? [1_000] : [1_000, 10_000, 50_000]) {
        const res = await app13b.fetch(
          new Request("http://localhost/g13/gated", {
            method: "POST",
            body: JSON.stringify({ n }),
            headers: { "content-type": "application/json" },
          }),
        );
        if (!res.ok) throw new Error(`g13 gated HTTP ${res.status}`);
        const wallUs = reportedUs;
        const perOpUs = Number((wallUs / (2 * n)).toFixed(4));
        metrics[`n${n}.wallMs`] = Number((wallUs / 1000).toFixed(3));
        metrics[`n${n}.perOpUs`] = perOpUs;
        console.log(`[G13b] n=${n}: ${metrics[`n${n}.wallMs`]}ms total, ${perOpUs}µs/gated-op`);
      }
      console.log("[G13b] metrics:", JSON.stringify(metrics));

      const issues: string[] = [];
      if ((metrics["n50000.perOpUs"] ?? 0) > (metrics["n1000.perOpUs"] ?? 0) * 5) {
        issues.push("gated() per-op cost grows super-linearly with cumulative calls");
      }

      const path = await writeArtifact({
        group: "G13b",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: "OKE_BENCH=1 bun test ./src/bench/g13-elements.bench.ts --timeout 300000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G13b] artifact: ${path}`);
      expect(issues.length).toBe(0);
    },
    CAL ? 60_000 : 240_000,
  );

  // --------------------------------------------------------- c. fx.json.stream
  test(
    "concurrent fx.json.stream via encodeSseStream",
    async () => {
      resetBindings();
      resetFlowSeq();
      const CHUNKS = CAL ? 8 : 32;

      function tokenDriver(chunks: number): AiDriver {
        return {
          id: "mock",
          async open() {
            return {
              driverId: "mock" as const,
              model: "smart",
              async complete() {
                return { text: "", model: "smart", driverId: "mock" as const };
              },
              async *stream() {
                for (let i = 0; i < chunks; i++) yield { text: `t${i}` };
              },
            };
          },
        };
      }

      const smart = ai.model("smart");
      on(
        http.get("/chat").public(),
        flow("g13.chat", {
          do: (_input, fx) => fx.json.stream(fx.stream(smart, { prompt: "hi" })),
        }),
      );
      const app13c = oke({
        name: "g13-stream",
        env: "test",
        startScheduler: false,
        gate: { unguardedHttp: "allow" },
        ai: { models: [smart], defaultDriver: tokenDriver(CHUNKS) },
      });

      const STREAMS = CAL ? 20 : 200;
      const CONCURRENCY = CAL ? 5 : 25;
      const latencies: number[] = [];
      let framesTotal = 0;
      let nextId = 0;

      const t0 = performance.now();
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (;;) {
            const id = ++nextId;
            if (id > STREAMS) return;
            const s = performance.now();
            const res = await app13c.fetch(new Request("http://localhost/chat"));
            if (!res.headers.get("content-type")?.includes("text/event-stream")) {
              throw new Error("g13 stream: not SSE");
            }
            const body = await res.text();
            framesTotal += body.split("\n").filter((l) => l.startsWith("data:")).length;
            latencies.push(performance.now() - s);
          }
        }),
      );
      const wallS = (performance.now() - t0) / 1000;
      const metrics: Record<string, number> = {
        streams: latencies.length,
        streamsPerSec: Number((latencies.length / wallS).toFixed(1)),
        sseFramesPerSec: Number((framesTotal / wallS).toFixed(1)),
        framesPerStream: CHUNKS + 1,
        streamP50Ms: Number(percentile(latencies, 50).toFixed(3)),
        streamP99Ms: Number(percentile(latencies, 99).toFixed(3)),
        concurrency: CONCURRENCY,
      };
      console.log("[G13c] metrics:", JSON.stringify(metrics));

      const issues: string[] = [];
      if (!latencies.every((ms) => ms < 30_000)) issues.push("stream latency outlier > 30s");

      const path = await writeArtifact({
        group: "G13c",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: "OKE_BENCH=1 bun test ./src/bench/g13-elements.bench.ts --timeout 300000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });
      console.log(`[G13c] artifact: ${path}`);
      expect(latencies.length).toBe(STREAMS);
    },
    CAL ? 60_000 : 180_000,
  );

  // ------------------------------------------------------- d. Channel bulk send
  test(
    "channel bulk send via RetryTransport → Mailpit",
    async () => {
      const up = await probeMailpit();
      if (!up) {
        console.warn(
          `[G13d] SKIPPED LOUDLY: no Mailpit SMTP on ${MAILPIT_HOST}:${MAILPIT_SMTP_PORT}`,
        );
        return;
      }

      let totalBefore = -1;
      try {
        const r = await fetch(`${MAILPIT_UI}/api/v1/messages?limit=1`);
        totalBefore = ((await r.json()) as { total: number }).total;
      } catch {
        /* UI count is advisory */
      }

      const WELCOME = channel.email().template("g13-bench-welcome");
      const catalog: TemplateCatalog = {
        "g13-bench-welcome": { en: { subject: "G13 bench", text: "Hello {{i}}" } },
      };
      const rt = createChannelRuntime({
        templates: [WELCOME],
        drivers: [openSmtpChannel({ host: MAILPIT_HOST, port: MAILPIT_SMTP_PORT })],
        catalog,
        retry: true, // wraps transports in sently RetryTransport
        now: () => Date.now(),
      });

      const SENDS = CAL ? 20 : 150;
      const CONCURRENCY = CAL ? 5 : 15;
      const latencies: number[] = [];
      let sent = 0;
      let failed = 0;
      let idx = 0;

      const t0 = performance.now();
      await Promise.all(
        Array.from({ length: CONCURRENCY }, async () => {
          for (;;) {
            const i = ++idx;
            if (i > SENDS) return;
            const s = performance.now();
            try {
              const r = await rt.send(WELCOME.name, {
                to: `g13-bench-${i}@example.test`,
                data: { i },
              });
              if (r.ok) sent++;
              else failed++;
            } catch {
              failed++;
            }
            latencies.push(performance.now() - s);
          }
        }),
      );
      const wallS = (performance.now() - t0) / 1000;

      let totalAfter = -1;
      try {
        const r = await fetch(`${MAILPIT_UI}/api/v1/messages?limit=1`);
        totalAfter = ((await r.json()) as { total: number }).total;
      } catch {
        /* advisory */
      }

      const metrics: Record<string, number> = {
        sends: SENDS,
        sendsOk: sent,
        sendsFailed: failed,
        sendsPerSec: Number((latencies.length / wallS).toFixed(2)),
        p50Ms: Number(percentile(latencies, 50).toFixed(3)),
        p99Ms: Number(percentile(latencies, 99).toFixed(3)),
        mailpitTotalBefore: totalBefore,
        mailpitTotalAfter: totalAfter,
        mailpitDelta: totalAfter >= 0 && totalBefore >= 0 ? totalAfter - totalBefore : -1,
      };
      console.log("[G13d] metrics:", JSON.stringify(metrics));

      const issues: string[] = [
        "calibration run 1 (pre-fix): 20/20 sends failed — channel runtime default sender " +
          "'oke@localhost' is dotless and rejected by sently SMTP address validation, so every " +
          "out-of-the-box email burned a ~3s RetryTransport cycle then failed against Mailpit",
        "calibration run 2 (post default-from fix): concurrent sends through ONE shared transport " +
          "interleave SMTP wire data — 'Unexpected SMTP response for DATA end', all sends failed after retries",
        ...(failed > 0 ? [`channel sends still failing through RetryTransport: ${failed}`] : []),
      ];

      const path = await writeArtifact({
        group: "G13d",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command: "OKE_BENCH=1 bun test ./src/bench/g13-elements.bench.ts --timeout 300000",
        metrics,
        issues,
        fixes: [
          "channel: default sender 'oke@localhost' → 'oke@localhost.test' in src/elements/channel/runtime.ts — " +
            "sently validates the From header (dotless domains rejected), so the old default could never deliver. " +
            "Regression test added: channel.test.ts 'default sender passes SMTP address validation'",
          "channel: per-transport send serialization in createChannelRuntime — sently transports are not safe " +
            "for concurrent send() on one shared socket; concurrent flows now queue instead of corrupting the " +
            "connection. Regression test added: channel.test.ts 'concurrent sends serialize per transport'. " +
            "Note: bulk email throughput is now bounded by one serialized wire conversation per transport instance",
        ],
        remeasured: {
          // Post-fix full run (this run).
          metrics: {
            sendsOk: metrics.sendsOk!,
            sendsFailed: metrics.sendsFailed!,
            sendsPerSec: metrics.sendsPerSec!,
            mailpitDelta: metrics.mailpitDelta!,
          },
          rerunScope: "full send sweep from t=0 after default-from + serialization fixes",
        },
      });
      console.log(`[G13d] artifact: ${path}`);
      expect(failed).toBe(0);
    },
    CAL ? 60_000 : 180_000,
  );
});

afterAll(() => {
  resetBindings();
  resetFlowSeq();
});
