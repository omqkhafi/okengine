/**
 * G17 — Hybrid SQL search (BM25 / LSH / fusion) load + recall gate.
 *
 * Do NOT publish latency / recall numbers from docs or marketing without
 * running this bench and recording honest artifacts.
 *
 * Run: OKE_BENCH=1 bun test src/bench/g17-hybrid-search.bench.ts --timeout 600000
 * Env: OKE_BENCH=1. OKE_BENCH_CAL=1 shrinks corpora. Live PG: OKE_TEST_POSTGRES=1.
 *
 * Corpus sizes (full): 1k · 10k · 100k · 1M × text-only / vector-only / hybrid.
 * Measures p50/p99 latency and precision@10 vs exact brute-force cosine baseline.
 */

import { describe, expect, test } from "bun:test";
import { fuseRrf } from "../elements/store/search-fusion.ts";
import { RRF_DEFAULT_K } from "../elements/store/search-errors.ts";
import { DISCLAIMER, HARDWARE, writeArtifact } from "./lib/report.ts";

const ENABLED = process.env.OKE_BENCH === "1";
// OKE_BENCH_CAL=1 will shrink corpora when full sweeps land.

describe.skipIf(!ENABLED)("G17 hybrid search", () => {
  test("scaffold records RRF constant + disclaimer (full corpus sweeps TBD)", () => {
    expect(RRF_DEFAULT_K).toBe(60);
    const lists = new Map([
      ["bm25", [{ id: "a", score: 1, rank: 1 }]],
      ["vector", [{ id: "a", score: 1, rank: 1 }]],
    ]);
    const hits = fuseRrf(lists, RRF_DEFAULT_K);
    expect(hits[0]!.id).toBe("a");

    writeArtifact({
      group: "g17-hybrid-search",
      hardware: HARDWARE,
      disclaimer: DISCLAIMER,
      command: "OKE_BENCH=1 bun test src/bench/g17-hybrid-search.bench.ts",
      metrics: { rrfDefaultK: RRF_DEFAULT_K },
      issues: [
        "Scaffold only — full corpus × mode sweeps + EXPLAIN + recall@10 pending before any published numbers",
      ],
      fixes: [],
      remeasured: null,
    });
  }, 30_000);
});
