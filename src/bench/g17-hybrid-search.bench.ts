/**
 * G17 — Hybrid SQL search (BM25 / LSH / fusion) load + recall gate.
 *
 * Real Postgres only (`OKE_TEST_POSTGRES=1` + `DATABASE_URL`). PGlite is
 * correctness-only — headline numbers come from a live instance.
 *
 * Run:
 *   OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL \
 *     bun test src/bench/g17-hybrid-search.bench.ts --timeout 3600000
 *
 * OKE_BENCH_CAL=1 shrinks corpora to 1k·10k for a calibration pass.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { DeclaredColumn, Manifest } from "../manifest/types.ts";
import type { SqlConnection } from "../drivers/types.ts";
import { connectPostgres } from "../drivers/postgres.ts";
import { runSearchBackfill } from "../elements/store/search-backfill.ts";
import {
  embColumn,
  ensureHyperplaneInserts,
  lshColumn,
  OKE_SEARCH_PLANES,
  OKE_TSV_COL,
  searchDdlForTable,
} from "../elements/store/search-ddl.ts";
import { LSH_DEFAULT_K, RRF_DEFAULT_K } from "../elements/store/search-errors.ts";
import {
  cosineSimilarity,
  deserializePlanes,
  lshBucket,
  lshBucketToSql,
  neighborBuckets,
} from "../elements/store/search-lsh.ts";
import { runSqlSearch, type SearchColumnMeta } from "../elements/store/search-runtime.ts";
import { resolveLivePg } from "./lib/infra.ts";
import { DISCLAIMER, HARDWARE, percentile, writeArtifact } from "./lib/report.ts";

const ENABLED = process.env.OKE_BENCH === "1";
const CAL = process.env.OKE_BENCH_CAL === "1";
const LIVE_URL = resolveLivePg();

/** Corpus sizes — full gate requires 1M. */
const CORPUS_SIZES = CAL ? [1_000, 10_000] : [1_000, 10_000, 100_000, 1_000_000];
/** Synthetic embedding dims (deterministic hash bag — not a production model). */
const DIMS = 32;
/** Latency samples per (size × mode). */
const LATENCY_ITERS = CAL ? 8 : 20;
/** Recall probes per size (vector / hybrid). */
const RECALL_QUERIES = CAL ? 5 : 12;
/** Exact baseline sample cap for 1M (full scan still runs; JS vector cache). */
const TABLE = "g17_docs";
const BACKFILL_TABLE = "g17_backfill";
/** Backfill interrupt after this many embedded column writes. */
const BACKFILL_KILL_AFTER = CAL ? 200 : 2_000;
const BACKFILL_ROWS = CAL ? 5_000 : 50_000;

const TOPICS = [
  "refund policy shipping delay",
  "password reset two factor auth",
  "invoice payment stripe webhook",
  "search ranking bm25 hybrid",
  "postgres gin btree index plan",
  "tenant isolation row level security",
  "durable flow journal resume",
  "live query fanout subscriber",
] as const;

interface LatencyPoint {
  readonly n: number;
  readonly mode: "text" | "vector" | "hybrid";
  readonly p50Ms: number;
  readonly p99Ms: number;
  readonly opsPerSec: number;
}

interface RecallPoint {
  readonly n: number;
  readonly mode: "vector" | "hybrid";
  readonly precisionAt10: number;
  readonly exactMsP50: number;
  readonly approxMsP50: number;
}

let conn: SqlConnection;
const issues: string[] = [];

beforeAll(async () => {
  if (!ENABLED) return;
  if (!LIVE_URL) {
    throw new Error("G17 requires OKE_TEST_POSTGRES=1 + DATABASE_URL (or OKE_TEST_POSTGRES_URL)");
  }
  conn = await connectPostgres({ url: LIVE_URL, pool: { max: 1 } });
}, 30_000);

afterAll(async () => {
  if (conn) await conn.close();
});

/**
 * Deterministic synthetic embedding — same text → same vector.
 *
 * @param text - Source text
 * @param dims - Dimensionality
 */
function synthEmbed(text: string, dims: number = DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of tokens) {
    const h = createHash("sha256").update(t).digest();
    for (let i = 0; i < dims; i++) {
      const byte = h[i % h.length]!;
      v[i]! += (byte / 255) * 2 - 1;
    }
  }
  // L2 normalize
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

/**
 * Minimal Manifest slice for {@link runSearchBackfill}.
 *
 * @param table - Table name
 * @param withEmbed - Include `.embed()` dims
 */
function benchManifest(table: string, withEmbed: boolean): Manifest {
  const body: DeclaredColumn = {
    type: "text",
    sqlName: "body",
    searchable: { weight: 1 },
    ...(withEmbed ? { embed: { dims: DIMS, model: "mock" } } : {}),
  };
  const title: DeclaredColumn = {
    type: "text",
    sqlName: "title",
    searchable: { weight: 2 },
  };
  const id: DeclaredColumn = { type: "text", sqlName: "id", primaryKey: true };
  return {
    version: 1,
    stores: {
      app: {
        facet: "sql",
        tables: {
          [table]: {
            columns: { id, title, body },
          },
        },
      },
    },
  } as unknown as Manifest;
}

const SEARCH_COLS: SearchColumnMeta[] = [
  { key: "title", sqlName: "title", weight: 2 },
  { key: "body", sqlName: "body", weight: 1, embed: { dims: DIMS, model: "mock" } },
];

/**
 * Drop + create table with search DDL + hyperplanes.
 *
 * @param table - Table name
 * @param withEmbed - Embed shadow columns
 */
async function prepareTable(table: string, withEmbed: boolean): Promise<void> {
  await conn.exec(`DROP TABLE IF EXISTS ${table} CASCADE`);
  await conn.exec(`
    CREATE TABLE ${table} (
      id text PRIMARY KEY,
      title text NOT NULL,
      body text NOT NULL
    )
  `);
  const cols: Record<string, DeclaredColumn> = {
    id: { type: "text", sqlName: "id", primaryKey: true },
    title: { type: "text", sqlName: "title", searchable: { weight: 2 } },
    body: {
      type: "text",
      sqlName: "body",
      searchable: { weight: 1 },
      ...(withEmbed ? { embed: { dims: DIMS, model: "mock" } } : {}),
    },
  };
  for (const stmt of searchDdlForTable(table, cols)) {
    await conn.exec(stmt);
  }
  if (withEmbed) {
    for (const ins of ensureHyperplaneInserts(table, cols)) {
      await conn.exec(ins.sql, ins.params);
    }
  }
}

/**
 * Bulk-load N docs with precomputed embeddings + LSH buckets + DF/stats.
 *
 * @param n - Row count
 */
async function seedCorpus(n: number): Promise<{
  readonly vectors: Float32Array[];
  readonly ids: string[];
  readonly titles: string[];
  readonly bodies: string[];
}> {
  await prepareTable(TABLE, true);
  const planesRow = await conn.query(
    `SELECT k, planes FROM ${OKE_SEARCH_PLANES} WHERE table_name = ? AND column_name = ?`,
    [TABLE, "body"],
  );
  const prow = planesRow[0]!;
  const k = Number(prow["k"] ?? LSH_DEFAULT_K);
  const planes = deserializePlanes(Buffer.from(prow["planes"] as Buffer), k);

  const vectors: Float32Array[] = new Array(n);
  const ids: string[] = new Array(n);
  const titles: string[] = new Array(n);
  const bodies: string[] = new Array(n);
  const batch = 500;
  const t0 = performance.now();

  for (let start = 0; start < n; start += batch) {
    const end = Math.min(n, start + batch);
    const values: unknown[] = [];
    const placeholders: string[] = [];
    for (let i = start; i < end; i++) {
      const topic = TOPICS[i % TOPICS.length]!;
      const id = `d${String(i).padStart(8, "0")}`;
      const title = `${topic} item ${i}`;
      const body = `${topic}. Document ${i} discusses ${topic} with enough tokens for BM25.`;
      const vec = synthEmbed(body, DIMS);
      const bucket = lshBucket(vec, planes);
      ids[i] = id;
      titles[i] = title;
      bodies[i] = body;
      vectors[i] = Float32Array.from(vec);
      placeholders.push(`(?, ?, ?, ?, ?)`);
      values.push(id, title, body, `{${vec.join(",")}}`, lshBucketToSql(bucket));
    }
    await conn.exec(
      `INSERT INTO ${TABLE} (id, title, body, ${embColumn("body")}, ${lshColumn("body")})
       VALUES ${placeholders.join(",")}`,
      values,
    );
  }

  // Rebuild corpus stats via backfill path (embed already present — skip re-embed).
  const result = await runSearchBackfill(conn, benchManifest(TABLE, true), {
    table: TABLE,
    batchSize: 1_000,
    embedPauseMs: 0,
    // No embed fn → stats/DF only; embeddings already bulk-loaded.
  });
  expect(result.rows).toBe(n);
  const loadMs = performance.now() - t0;
  console.log(`G17 seeded n=${n} in ${(loadMs / 1000).toFixed(1)}s`);

  return { vectors, ids, titles, bodies };
}

/**
 * Exact top-K by cosine against in-memory vectors.
 *
 * @param query - Query vector
 * @param vectors - Corpus
 * @param k - Top-k
 */
function exactTopK(
  query: readonly number[],
  vectors: readonly Float32Array[],
  k: number,
): string[] {
  const scored: Array<{ i: number; s: number }> = [];
  for (let i = 0; i < vectors.length; i++) {
    scored.push({ i, s: cosineSimilarity(query, Array.from(vectors[i]!)) });
  }
  scored.sort((a, b) => b.s - a.s);
  return scored.slice(0, k).map((x) => `d${String(x.i).padStart(8, "0")}`);
}

/**
 * Precision@K — fraction of approx top-K that appear in exact top-K.
 *
 * @param exact - Exact ids
 * @param approx - Approx ids
 * @param k - K
 */
function precisionAtK(exact: readonly string[], approx: readonly string[], k: number): number {
  const set = new Set(exact.slice(0, k));
  let hit = 0;
  for (const id of approx.slice(0, k)) {
    if (set.has(id)) hit += 1;
  }
  return hit / k;
}

describe.skipIf(!ENABLED)("G17 hybrid search", () => {
  test(
    "corpus × mode latency, LSH recall vs exact cosine, EXPLAIN, backfill kill/resume",
    async () => {
      expect(LIVE_URL).toBeTruthy();
      expect(RRF_DEFAULT_K).toBe(60);

      const latency: LatencyPoint[] = [];
      const recall: RecallPoint[] = [];
      let explainText = "";
      let backfill: Record<string, number | boolean | string> = {};

      // --- Backfill timing + kill/resume on a pre-populated table ---
      {
        await prepareTable(BACKFILL_TABLE, true);
        const bfBatch = 100;
        for (let start = 0; start < BACKFILL_ROWS; start += bfBatch) {
          const end = Math.min(BACKFILL_ROWS, start + bfBatch);
          const values: unknown[] = [];
          const ph: string[] = [];
          for (let i = start; i < end; i++) {
            const topic = TOPICS[i % TOPICS.length]!;
            ph.push(`(?, ?, ?)`);
            values.push(`b${i}`, `${topic} ${i}`, `${topic} body ${i}`);
          }
          await conn.exec(
            `INSERT INTO ${BACKFILL_TABLE} (id, title, body) VALUES ${ph.join(",")}`,
            values,
          );
        }

        let embeddedBeforeKill = 0;
        const killCtrl = new AbortController();
        const tKill0 = performance.now();
        try {
          await runSearchBackfill(conn, benchManifest(BACKFILL_TABLE, true), {
            table: BACKFILL_TABLE,
            batchSize: 50,
            embedPauseMs: 0,
            signal: killCtrl.signal,
            embed: async (_model, text, dims) => {
              embeddedBeforeKill += 1;
              if (embeddedBeforeKill >= BACKFILL_KILL_AFTER) killCtrl.abort();
              return synthEmbed(text, dims);
            },
          });
          issues.push("backfill kill did not interrupt before completion");
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if (!/abort/i.test(msg) && killCtrl.signal.aborted !== true) {
            throw err instanceof Error ? err : new Error(msg);
          }
        }
        const killMs = performance.now() - tKill0;
        const partial = await conn.query(
          `SELECT count(*)::int AS c FROM ${BACKFILL_TABLE} WHERE ${embColumn("body")} IS NOT NULL`,
        );
        const partialCount = Number(partial[0]?.["c"] ?? 0);
        if (partialCount === 0) {
          throw new Error(
            `backfill kill left 0 embeddings (killAfter=${BACKFILL_KILL_AFTER}); see prior catch issues: ${issues.join("; ")}`,
          );
        }
        expect(partialCount).toBeGreaterThan(0);
        expect(partialCount).toBeLessThan(BACKFILL_ROWS);

        const tResume0 = performance.now();
        const resumed = await runSearchBackfill(conn, benchManifest(BACKFILL_TABLE, true), {
          table: BACKFILL_TABLE,
          batchSize: 200,
          embedPauseMs: 0,
          embed: async (_model, text, dims) => synthEmbed(text, dims),
        });
        const resumeMs = performance.now() - tResume0;
        expect(resumed.rows).toBe(BACKFILL_ROWS);
        const full = await conn.query(
          `SELECT count(*)::int AS c FROM ${BACKFILL_TABLE} WHERE ${embColumn("body")} IS NOT NULL`,
        );
        expect(Number(full[0]?.["c"] ?? 0)).toBe(BACKFILL_ROWS);

        backfill = {
          rows: BACKFILL_ROWS,
          killAfterEmbeds: BACKFILL_KILL_AFTER,
          embedsAtKill: partialCount,
          killWallMs: Number(killMs.toFixed(1)),
          resumeWallMs: Number(resumeMs.toFixed(1)),
          resumeEmbedded: resumed.embedded,
          resumable: true,
        };
        console.log("G17 backfill kill/resume", backfill);
      }

      // --- Per-corpus latency + recall ---
      for (const n of CORPUS_SIZES) {
        const corpus = await seedCorpus(n);

        // EXPLAIN once at 100k (or largest CAL size) — real plan artifact.
        if ((CAL && n === CORPUS_SIZES[CORPUS_SIZES.length - 1]) || n === 100_000) {
          const qVec = synthEmbed(TOPICS[0]!, DIMS);
          const planesRow = await conn.query(
            `SELECT k, planes FROM ${OKE_SEARCH_PLANES} WHERE table_name = ? AND column_name = ?`,
            [TABLE, "body"],
          );
          const prow = planesRow[0]!;
          const kPlanes = Number(prow["k"] ?? LSH_DEFAULT_K);
          const planes = deserializePlanes(Buffer.from(prow["planes"] as Buffer), kPlanes);
          const bucket = lshBucket(qVec, planes);
          const buckets = neighborBuckets(bucket, kPlanes).map((b) => lshBucketToSql(b));
          const explainSql = `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
            SELECT id FROM ${TABLE}
            WHERE ${OKE_TSV_COL} @@ plainto_tsquery('english', $1)
               OR ${lshColumn("body")} = ANY($2::bigint[])
            LIMIT 50`;
          // Bun.SQL uses ? placeholders — fall back to interpolated literals for EXPLAIN only.
          const safeQ = TOPICS[0]!.replaceAll("'", "''");
          const bucketList = buckets.join(",");
          const explainRows = await conn.query(
            `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
             SELECT id FROM ${TABLE}
             WHERE ${OKE_TSV_COL} @@ plainto_tsquery('english', '${safeQ}')
                OR ${lshColumn("body")} = ANY(ARRAY[${bucketList}]::bigint[])
             LIMIT 50`,
          );
          explainText = explainRows.map((r) => String(Object.values(r)[0] ?? "")).join("\n");
          void explainSql;
          console.log("G17 EXPLAIN (ANALYZE, BUFFERS):\n" + explainText);
          if (!/Bitmap|Index|Seq Scan|BitmapOr|Bitmap Heap/i.test(explainText)) {
            issues.push("EXPLAIN text lacked recognizable Postgres plan nodes");
          }
        }

        const modes = [
          {
            mode: "text" as const,
            query: TOPICS[0]!,
            embedQuery: undefined as undefined | ((text: string) => Promise<readonly number[]>),
          },
          {
            mode: "vector" as const,
            // Lexically rare token so GIN contributes little; LSH buckets carry the load.
            query: "zxqwv semantic neighbor probe",
            embedQuery: async (text: string) =>
              synthEmbed(text.includes("zxqwv") ? TOPICS[3]! : text, DIMS),
          },
          {
            mode: "hybrid" as const,
            query: TOPICS[3]!,
            embedQuery: async (text: string) => synthEmbed(text, DIMS),
          },
        ];

        for (const m of modes) {
          const samples: number[] = [];
          for (let i = 0; i < LATENCY_ITERS; i++) {
            const t0 = performance.now();
            await runSqlSearch({
              conn,
              table: TABLE,
              columns: SEARCH_COLS,
              pkSqlName: "id",
              options: { query: m.query, limit: 10 },
              ...(m.embedQuery ? { embedQuery: m.embedQuery } : {}),
            });
            samples.push(performance.now() - t0);
          }
          const p50 = percentile(samples, 50);
          const p99 = percentile(samples, 99);
          const total = samples.reduce((a, b) => a + b, 0);
          latency.push({
            n,
            mode: m.mode,
            p50Ms: Number(p50.toFixed(2)),
            p99Ms: Number(p99.toFixed(2)),
            opsPerSec: Number(((samples.length / total) * 1000).toFixed(1)),
          });
        }

        // Recall: LSH approximate path vs exact brute-force cosine on SAME vectors.
        for (const mode of ["vector", "hybrid"] as const) {
          const scores: number[] = [];
          const exactMs: number[] = [];
          const approxMs: number[] = [];
          for (let q = 0; q < RECALL_QUERIES; q++) {
            const topic = TOPICS[q % TOPICS.length]!;
            const qVec = synthEmbed(topic, DIMS);
            const te0 = performance.now();
            const exact = exactTopK(qVec, corpus.vectors, 10);
            exactMs.push(performance.now() - te0);

            const ta0 = performance.now();
            const result = await runSqlSearch({
              conn,
              table: TABLE,
              columns: SEARCH_COLS,
              pkSqlName: "id",
              options: {
                query: mode === "vector" ? `zxqwv ${topic}` : topic,
                limit: 10,
              },
              embedQuery: async () => qVec,
            });
            approxMs.push(performance.now() - ta0);
            const approxIds = result.data.map((r) => String(r["id"]));
            scores.push(precisionAtK(exact, approxIds, 10));
          }
          const pAt10 = scores.reduce((a, b) => a + b, 0) / scores.length;
          recall.push({
            n,
            mode,
            precisionAt10: Number(pAt10.toFixed(3)),
            exactMsP50: Number(percentile(exactMs, 50).toFixed(2)),
            approxMsP50: Number(percentile(approxMs, 50).toFixed(2)),
          });
          if (pAt10 < 0.3) {
            issues.push(
              `honest low recall: n=${n} mode=${mode} precision@10=${pAt10.toFixed(3)} (LSH approx vs exact cosine)`,
            );
          }
        }
      }

      const metrics: Record<string, number> = {
        rrfDefaultK: RRF_DEFAULT_K,
        dims: DIMS,
        backfillRows: Number(backfill.rows),
        backfillResumeMs: Number(backfill.resumeWallMs),
        backfillEmbedsAtKill: Number(backfill.embedsAtKill),
      };
      for (const p of latency) {
        metrics[`n${p.n}_${p.mode}_p50Ms`] = p.p50Ms;
        metrics[`n${p.n}_${p.mode}_p99Ms`] = p.p99Ms;
        metrics[`n${p.n}_${p.mode}_opsPerSec`] = p.opsPerSec;
      }
      for (const r of recall) {
        metrics[`n${r.n}_${r.mode}_precisionAt10`] = r.precisionAt10;
        metrics[`n${r.n}_${r.mode}_exactMsP50`] = r.exactMsP50;
        metrics[`n${r.n}_${r.mode}_approxMsP50`] = r.approxMsP50;
      }

      const path = await writeArtifact({
        group: "g17-hybrid-search",
        hardware: HARDWARE,
        disclaimer: DISCLAIMER,
        command:
          "OKE_BENCH=1 OKE_TEST_POSTGRES=1 DATABASE_URL=$DATABASE_URL bun test src/bench/g17-hybrid-search.bench.ts --timeout 3600000",
        metrics,
        issues,
        fixes: [],
        remeasured: null,
      });

      // Persist EXPLAIN + tables beside the JSON for REPORT.md authorship.
      const reportSide = new URL("./results/", import.meta.url).pathname;
      await Bun.write(
        `${reportSide}g17-explain-${Date.now()}.txt`,
        explainText || "(no EXPLAIN captured)\n",
      );
      await Bun.write(
        `${reportSide}g17-summary-${Date.now()}.json`,
        `${JSON.stringify({ latency, recall, backfill, explainText, issues }, null, 2)}\n`,
      );

      console.log(`G17 artifact → ${path}`);
      console.table(latency);
      console.table(recall);
      expect(latency.length).toBe(CORPUS_SIZES.length * 3);
      expect(recall.length).toBe(CORPUS_SIZES.length * 2);
      expect(String(backfill.resumable)).toBe("true");
      expect(explainText.length).toBeGreaterThan(20);
    },
    CAL ? 600_000 : 3_600_000,
  );
});
