/**
 * Hybrid search runtime — PGlite end-to-end for LSH candidate SQL.
 *
 * Captures the literal SQL `runSqlSearch` issues and checks K=64 Hamming-rank
 * recovery on the same synthetic hash-bag G17 uses (40-row hand case).
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import type { DeclaredColumn } from "../../manifest/types.ts";
import { pgliteDriver } from "../../drivers/pglite.ts";
import type { SqlConnection } from "../../drivers/types.ts";
import {
  embColumn,
  ensureHyperplaneInserts,
  lshColumn,
  OKE_SEARCH_PLANES,
  searchDdlForTable,
} from "./search-ddl.ts";
import { LSH_DEFAULT_K } from "./search-errors.ts";
import {
  cosineSimilarity,
  deserializePlanes,
  lshBucket,
  lshBucketFromSql,
  lshBucketToSql,
} from "./search-lsh.ts";
import { runSqlSearch, type SearchColumnMeta } from "./search-runtime.ts";

const TABLE = "lsh_recall_docs";
const DIMS = 32;
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

const COLS: Record<string, DeclaredColumn> = {
  id: { type: "text", sqlName: "id", primaryKey: true },
  title: { type: "text", sqlName: "title", searchable: { weight: 2 } },
  body: {
    type: "text",
    sqlName: "body",
    searchable: { weight: 1 },
    embed: { dims: DIMS, model: "mock" },
  },
};

const SEARCH_COLS: SearchColumnMeta[] = [
  { key: "title", sqlName: "title", weight: 2 },
  { key: "body", sqlName: "body", weight: 1, embed: { dims: DIMS, model: "mock" } },
];

let conn: SqlConnection;

beforeAll(async () => {
  conn = await pgliteDriver.connect({ url: "memory://lsh-recall-runtime", role: "primary" });
}, 20_000);

afterAll(async () => {
  await conn.close();
});

/**
 * G17 synthetic embedding — deterministic SHA-256 hash bag, L2-normalized.
 *
 * @param text - Source text
 */
function synthEmbed(text: string): number[] {
  const v = Array.from({ length: DIMS }, () => 0);
  const tokens = text.toLowerCase().split(/\W+/).filter(Boolean);
  for (const t of tokens) {
    const h = createHash("sha256").update(t).digest();
    for (let i = 0; i < DIMS; i++) {
      v[i]! += (h[i % h.length]! / 255) * 2 - 1;
    }
  }
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  return v.map((x) => x / norm);
}

describe("runSqlSearch LSH candidate path (PGlite)", () => {
  test("issued SQL ranks by bit_count Hamming, not Hamming-1 ANY(); recovers exact top-10", async () => {
    await conn.exec(`DROP TABLE IF EXISTS ${TABLE} CASCADE`);
    await conn.exec(`
      CREATE TABLE ${TABLE} (
        id text PRIMARY KEY,
        title text NOT NULL,
        body text NOT NULL
      )
    `);
    for (const stmt of searchDdlForTable(TABLE, COLS)) {
      await conn.exec(stmt);
    }
    for (const ins of ensureHyperplaneInserts(TABLE, COLS)) {
      await conn.exec(ins.sql, ins.params);
    }

    const planesRow = await conn.query(
      `SELECT k, planes FROM ${OKE_SEARCH_PLANES} WHERE table_name = ? AND column_name = ?`,
      [TABLE, "body"],
    );
    const prow = planesRow[0]!;
    const k = Number(prow["k"] ?? LSH_DEFAULT_K);
    const planes = deserializePlanes(Buffer.from(prow["planes"] as Buffer), k);

    const vectors: number[][] = [];
    const n = 40;
    for (let i = 0; i < n; i++) {
      const topic = TOPICS[i % TOPICS.length]!;
      const id = `d${String(i).padStart(8, "0")}`;
      const title = `${topic} item ${i}`;
      const body = `${topic}. Document ${i} discusses ${topic} with enough tokens for BM25.`;
      const vec = synthEmbed(body);
      const bucket = lshBucket(vec, planes);
      vectors.push(vec);
      await conn.exec(
        `INSERT INTO ${TABLE} (id, title, body, ${embColumn("body")}, ${lshColumn("body")})
         VALUES (?, ?, ?, ?, ?)`,
        [id, title, body, `{${vec.join(",")}}`, lshBucketToSql(bucket)],
      );
    }

    // Write/query identity for one stored row vs re-projection of the same body.
    const stored = await conn.query(`SELECT ${lshColumn("body")} AS b FROM ${TABLE} WHERE id = ?`, [
      "d00000000",
    ]);
    const body0 = `${TOPICS[0]}. Document 0 discusses ${TOPICS[0]} with enough tokens for BM25.`;
    const queryBucket = lshBucket(synthEmbed(body0), planes);
    expect(lshBucketFromSql(stored[0]?.["b"])).toBe(queryBucket);

    const captured: Array<{ sql: string; params: readonly unknown[] }> = [];
    const tapped: SqlConnection = {
      driverId: conn.driverId,
      role: conn.role,
      query: async (sql, params = []) => {
        captured.push({ sql, params });
        return conn.query(sql, params);
      },
      exec: (sql, params) => conn.exec(sql, params),
      close: () => conn.close(),
    };

    const qVec = synthEmbed(TOPICS[0]!);
    const result = await runSqlSearch({
      conn: tapped,
      table: TABLE,
      columns: SEARCH_COLS,
      pkSqlName: "id",
      options: { query: `zxqwv ${TOPICS[0]}`, limit: 10 },
      embedQuery: async () => qVec,
    });

    const candidate = captured.find((c) => /UNION/i.test(c.sql) && /bit_count/i.test(c.sql));
    expect(candidate).toBeDefined();
    expect(candidate!.sql).toContain("bit_count");
    expect(candidate!.sql).toContain("ORDER BY");
    expect(candidate!.sql).not.toMatch(/=\s*ANY\s*\(/i);
    // Bound query bucket is the signed int64 pack of the query vector.
    expect(candidate!.params).toContain(lshBucketToSql(lshBucket(qVec, planes)));

    const scored: Array<{ i: number; s: number }> = [];
    for (let i = 0; i < vectors.length; i++) {
      scored.push({ i, s: cosineSimilarity(qVec, vectors[i]!) });
    }
    scored.sort((a, b) => b.s - a.s);
    const exact = new Set(scored.slice(0, 10).map((x) => `d${String(x.i).padStart(8, "0")}`));
    const approx = result.data.map((r) => String(r["id"]));
    let hits = 0;
    for (const id of approx.slice(0, 10)) {
      if (exact.has(id)) hits += 1;
    }
    // Hamming-1 equality recovered 0/10 on this corpus. Hamming-rank UNION
    // plus in-process cosine/RRF must recover a real majority of exact neighbors.
    expect(result.data).toHaveLength(10);
    expect(hits / 10).toBeGreaterThanOrEqual(0.5);
    expect(result.meta.engine).toContain("lsh");
  }, 30_000);
});
