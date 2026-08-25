/**
 * Bench harness smoke — validates the report/sampler/lag libs and gives
 * `bun run bench:load` a runnable target before group benches land.
 * Runs everywhere (no live infra required).
 */

import { describe, expect, test } from "bun:test";
import { measureEventLoopLag } from "./lib/event-loop-lag.ts";
import { percentile, summarize, DISCLAIMER, HARDWARE } from "./lib/report.ts";
import { rssSlopeMbPerMin, type RssSample } from "./lib/rss-sampler.ts";

describe("bench harness smoke", () => {
  test("percentile + summarize", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([], 50)).toBeNaN();
    const s = summarize([10, 20, 30]);
    expect(s.opsPerSec).toBeGreaterThan(0);
    expect(s.p99Ms).toBeGreaterThanOrEqual(s.p50Ms);
  });

  test("rss slope on synthetic samples", () => {
    const samples: RssSample[] = Array.from({ length: 6 }, (_, i) => ({
      tMs: i * 5000,
      rssMb: 100 + i * 10,
      fds: 20,
    }));
    // 10 MB per 5 s = 120 MB/min.
    expect(rssSlopeMbPerMin(samples)).toBeCloseTo(120, -1);
    expect(rssSlopeMbPerMin([])).toBe(0);
  });

  test("event loop lag probe collects samples", async () => {
    const probe = measureEventLoopLag(25);
    await Bun.sleep(120);
    probe.stop();
    expect(probe.lags().length).toBeGreaterThan(1);
  });

  test("artifact constants", () => {
    expect(HARDWARE).toContain("M4");
    expect(DISCLAIMER).toContain("not SLA");
  });
});
