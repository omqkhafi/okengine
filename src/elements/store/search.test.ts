/**
 * Built-in hybrid search — unit correctness (BM25F, LSH, RRF, searchable API).
 */

import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { field, store } from "../store.ts";
import { bm25fScore, termFrequencies, tokenize } from "./search-bm25.ts";
import { fuseLists, fuseRrf, fuseWeighted } from "./search-fusion.ts";
import { LSH_DEFAULT_K, RRF_DEFAULT_K, SearchConfigError } from "./search-errors.ts";
import {
  cosineSimilarity,
  deserializePlanes,
  generateHyperplanes,
  hammingDistance,
  hyperplaneSeed,
  lshBucket,
  lshBucketFromSql,
  lshBucketToSql,
  lshHammingSql,
  neighborBuckets,
  serializePlanes,
} from "./search-lsh.ts";

describe("field.searchable / .embed", () => {
  test("searchable weight defaults to 1; embed requires prior searchable", () => {
    const articles = store.schema.table("articles", {
      id: field.text().primaryKey(),
      title: field.text().searchable({ weight: 2 }).notNull(),
      body: field.text().searchable().embed({ dims: 8, model: "embedder" }),
    });
    expect(articles.columns.title.search).toEqual({ searchable: true, weight: 2 });
    expect(articles.columns.body.search?.embed).toEqual({ dims: 8, model: "embedder" });
    expect(() => field.text().embed({ dims: 8 })).toThrow(/prior \.searchable/);
  });

  test("bare .embed() and partial options are allowed at declare time", () => {
    const bare = field.text().searchable().embed();
    const modelOnly = field.text().searchable().embed({ model: "embedder" });
    expect(bare).toBeDefined();
    expect(modelOnly).toBeDefined();
    const table = store.schema.table("articles", {
      id: field.text().primaryKey(),
      body: field.text().searchable().embed(),
      caption: field.text().searchable().embed({ model: "other" }),
    });
    expect(table.columns.body.search?.embed).toEqual({});
    expect(table.columns.caption.search?.embed).toEqual({ model: "other" });
  });
});

describe("BM25F", () => {
  test("field weight applied before saturation matches hand reference", () => {
    const query = ["cat"];
    const df = new Map([["cat", 1]]);
    const N = 2;
    const avgdl = 2;
    // Doc A: title has cat once (weight 2); Doc B: body has cat once (weight 1)
    const scoreA = bm25fScore(
      query,
      [{ weight: 2, tf: termFrequencies(["cat"]) }],
      1,
      avgdl,
      N,
      df,
    );
    const scoreB = bm25fScore(
      query,
      [{ weight: 1, tf: termFrequencies(["cat"]) }],
      1,
      avgdl,
      N,
      df,
    );
    expect(scoreA).toBeGreaterThan(scoreB);
    // Hand: weightedTf=2 vs 1 with same IDF → A ranks higher
    expect(tokenize("Hello, CAT!")).toEqual(["hello", "cat"]);
  });
});

describe("LSH", () => {
  test("planes are stable for the same seed; near vectors collide", () => {
    const seed = hyperplaneSeed("articles", "body", 8, 16);
    const a = generateHyperplanes(seed, 8, 16);
    const b = generateHyperplanes(seed, 8, 16);
    expect(a[0]![0]).toBe(b[0]![0]);
    const v = [1, 0, 0, 0, 0, 0, 0, 0];
    const near = [0.99, 0.01, 0, 0, 0, 0, 0, 0];
    const ba = lshBucket(v, a);
    const bn = lshBucket(near, a);
    // Exact or Hamming-1 neighbor should include near for this orientation
    const neighbors = new Set(neighborBuckets(ba, 16).map(String));
    expect(neighbors.has(String(bn)) || ba === bn).toBe(true);
    expect(cosineSimilarity(v, near)).toBeGreaterThan(0.9);
  });

  test("dimension mismatch fails loud", () => {
    const planes = generateHyperplanes("s", 4, 8);
    expect(() => lshBucket([1, 2], planes)).toThrow(/length/);
  });

  test("lshBucketToSql round-trips high bit into signed bigint range", () => {
    const high = 1n << 63n;
    const sql = lshBucketToSql(high);
    expect(BigInt(sql) < 0n).toBe(true);
    expect(lshBucketFromSql(sql)).toBe(high);
    expect(lshBucketToSql(42n)).toBe("42");
  });

  test("write-time and query-time buckets are identical for the same vector", () => {
    const seed = hyperplaneSeed("g17_docs", "body", 32, LSH_DEFAULT_K);
    const planes = generateHyperplanes(seed, 32, LSH_DEFAULT_K);
    const reloaded = deserializePlanes(serializePlanes(planes), LSH_DEFAULT_K);
    const vector = synthHashBag(
      "refund policy shipping delay. Document 0 discusses refund policy shipping delay.",
    );
    const write = lshBucket(vector, planes);
    const query = lshBucket(vector, reloaded);
    expect(write).toBe(query);
    expect(lshBucketToSql(write)).toBe(lshBucketToSql(query));
    expect(neighborBuckets(write, LSH_DEFAULT_K)).toHaveLength(LSH_DEFAULT_K + 1);
  });

  test("K=64 Hamming-1 misses G17-like neighbors; Hamming-rank recovers them", () => {
    // Same deterministic hash-bag generator G17 uses — 40 docs, 8 topics.
    const topics = [
      "refund policy shipping delay",
      "password reset two factor auth",
      "invoice payment stripe webhook",
      "search ranking bm25 hybrid",
      "postgres gin btree index plan",
      "tenant isolation row level security",
      "durable flow journal resume",
      "live query fanout subscriber",
    ];
    const planes = generateHyperplanes(hyperplaneSeed("g17_docs", "body", 32, 64), 32, 64);
    const docs = topics.flatMap((topic, t) =>
      [0, 1, 2, 3, 4].map((n) => {
        const i = t + n * 8;
        const body = `${topic}. Document ${i} discusses ${topic} with enough tokens for BM25.`;
        const vec = synthHashBag(body);
        return { i, vec, bucket: lshBucket(vec, planes) };
      }),
    );
    const qVec = synthHashBag(topics[0]!);
    const qBucket = lshBucket(qVec, planes);
    const scored = docs.map((d) => ({
      i: d.i,
      cos: cosineSimilarity(qVec, d.vec),
      ham: hammingDistance(qBucket, d.bucket),
    }));
    const exact = [...scored].sort((a, b) => b.cos - a.cos).slice(0, 10);
    const exactSet = new Set(exact.map((x) => x.i));
    const ham1 = scored.filter((s) => s.ham <= 1);
    const ham1Hits = ham1.filter((s) => exactSet.has(s.i)).length;
    const ranked = [...scored].sort((a, b) => a.ham - b.ham || b.cos - a.cos).slice(0, 50);
    const rankedTop = [...ranked].sort((a, b) => b.cos - a.cos).slice(0, 10);
    const rankedHits = rankedTop.filter((s) => exactSet.has(s.i)).length;
    // Hamming-1 is the broken probe (G17 P@10 ≈ 0). Hamming-rank of the K=64
    // pack recovers the exact cosine top-10 on this 40-row hand case.
    expect(ham1Hits).toBe(0);
    expect(rankedHits).toBe(10);
    expect(exact.every((e) => e.ham > 1)).toBe(true);
    expect(lshHammingSql("__oke_lsh_body")).toContain("bit_count");
  });
});

/**
 * G17 synthetic embedding — deterministic SHA-256 hash bag, L2-normalized.
 *
 * @param text - Source text
 */
function synthHashBag(text: string, dims = 32): number[] {
  const v = Array.from({ length: dims }, () => 0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of tokens) {
    const h = createHash("sha256").update(t).digest();
    for (let i = 0; i < dims; i++) {
      v[i]! += (h[i % h.length]! / 255) * 2 - 1;
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

describe("fusion", () => {
  test("RRF default k=60 matches Cormack hand ranks", () => {
    expect(RRF_DEFAULT_K).toBe(60);
    const lists = new Map([
      [
        "bm25",
        [
          { id: "a", score: 10, rank: 1 },
          { id: "b", score: 5, rank: 2 },
        ],
      ],
      [
        "vector",
        [
          { id: "b", score: 0.9, rank: 1 },
          { id: "a", score: 0.5, rank: 2 },
        ],
      ],
    ]);
    const hits = fuseRrf(lists, 60);
    // a: 1/61 + 1/62; b: 1/62 + 1/61 — equal contributions swapped → tied-ish; b wins on equal?
    // a = 1/61 + 1/62; b = 1/62 + 1/61 — identical
    expect(hits[0]!.score).toBeCloseTo(hits[1]!.score, 10);
    const weighted = fuseWeighted(lists, { bm25: 1, vector: 0 });
    expect(weighted[0]!.id).toBe("a");
    const fused = fuseLists(lists);
    expect(fused.strategy).toBe("rrf");
    expect(fused.k).toBe(60);
  });
});

describe("SearchConfigError", () => {
  test("names table and column", () => {
    const err = new SearchConfigError("notes", "body", "missing ai");
    expect(err.name).toBe("SearchConfigError");
    expect(err.table).toBe("notes");
    expect(err.message).toContain("notes.body");
  });
});
