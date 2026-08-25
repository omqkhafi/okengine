/**
 * OKID throughput benchmark — informative, not a gate.
 *
 * Compares the default generator, the sortable variant, and the worst-case
 * rejection-sampling configuration against the platform primitive
 * (`crypto.randomUUID`). Environment-sensitive numbers; no absolute claims.
 */

import { describe, test } from "bun:test";
import { okid } from "./okid.ts";

/** Volumes measured per variant (ids/sec scales linearly here). */
const VOLUMES = [100_000] as const;
const FULL_VOLUME = 1_000_000;

interface Sample {
  readonly name: string;
  readonly idsPerSecond: number;
  readonly meanNs: number;
}

function measure(name: string, generate: () => string, count: number): Sample {
  // Warm-up pass — stabilize JIT before timing.
  for (let i = 0; i < 1_000; i++) generate();
  const t0 = performance.now();
  for (let i = 0; i < count; i++) generate();
  const elapsedMs = performance.now() - t0;
  const idsPerSecond = Math.round((count / elapsedMs) * 1_000);
  return {
    name,
    idsPerSecond,
    meanNs: Math.round((elapsedMs * 1e6) / count),
  };
}

function runSuite(label: string, count: number): void {
  console.log(`\nokid-bench ${label} n=${count.toLocaleString("en-US")}`);
  const samples = [
    measure("okid()", () => okid(), count),
    measure("okid(21)", () => okid(21), count),
    measure("okid({sortable:true})", () => okid({ sortable: true }), count),
    measure("okid({lookAlikes:false})", () => okid({ lookAlikes: false }), count),
    measure("crypto.randomUUID()", () => crypto.randomUUID(), count),
  ];
  for (const s of samples) {
    console.log(
      `  ${s.name.padEnd(30)} ${s.idsPerSecond.toLocaleString("en-US").padStart(14)} ids/s   ~${String(s.meanNs).padStart(4)} ns/id`,
    );
  }
}

describe("okid benchmark", () => {
  if (process.env.OKE_FAST_TESTS === "1") return;

  for (const volume of VOLUMES) {
    test(`100k-volume throughput (${volume.toLocaleString("en-US")} ids)`, () => {
      runSuite(`${volume}`, volume);
    });
  }

  test("1M-volume throughput", () => {
    runSuite("full", FULL_VOLUME);
  }, 60_000);
});
