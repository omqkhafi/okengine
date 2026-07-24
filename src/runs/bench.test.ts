/**
 * 1M-row query benchmark — Parquet + DuckDB (files driver path).
 *
 * Gate: bun test src/runs (includes this file).
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { duckPath, duckQuery, openDuckDB } from "./duckdb.ts";

/** Soft budget for a filtered aggregate over 1M Parquet rows. */
export const RUNS_1M_QUERY_BUDGET_MS = 5_000;

const ROW_COUNT = 1_000_000;

describe("runs 1M-row query benchmark", () => {
  let dir = "";
  let parquetPath = "";

  test("generate 1M-row Parquet partition", async () => {
    dir = await mkdtemp(join(tmpdir(), "oke-runs-bench-"));
    parquetPath = join(dir, "runs-1m.parquet");
    const session = await openDuckDB();
    try {
      const t0 = performance.now();
      await session.conn.run(`
        COPY (
          SELECT
            i AS id,
            'book.create' AS flow,
            CASE WHEN i % 10 = 0 THEN 'miss' ELSE 'hit' END AS cache,
            i % 50 AS tenant,
            (i % 100)::DOUBLE AS duration_ms
          FROM range(${ROW_COUNT}) t(i)
        ) TO '${duckPath(parquetPath)}' (FORMAT PARQUET, COMPRESSION ZSTD)
      `);
      const genMs = performance.now() - t0;
      console.log(
        `runs-bench generate rows=${ROW_COUNT} parquet_ms=${genMs.toFixed(1)}`,
      );
      expect(await Bun.file(parquetPath).exists()).toBe(true);
    } finally {
      session.close();
    }
  });

  test(`query 1M rows under ${RUNS_1M_QUERY_BUDGET_MS} ms`, async () => {
    expect(parquetPath.length).toBeGreaterThan(0);
    const session = await openDuckDB();
    try {
      await session.conn.run(
        `CREATE VIEW runs AS SELECT * FROM read_parquet('${duckPath(parquetPath)}')`,
      );
      // Warm once
      await duckQuery(session.conn, "SELECT count(*)::DOUBLE AS c FROM runs");

      const samples: number[] = [];
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const rows = await duckQuery(
          session.conn,
          `
          SELECT cache, count(*)::DOUBLE AS n, avg(duration_ms) AS avg_ms
          FROM runs
          WHERE duration_ms > 50
          GROUP BY cache
          ORDER BY n DESC
          `,
        );
        const ms = performance.now() - t0;
        samples.push(ms);
        expect(rows.length).toBeGreaterThan(0);
        const total = rows.reduce((a, r) => a + Number(r.n ?? 0), 0);
        expect(total).toBeGreaterThan(0);
      }
      samples.sort((a, b) => a - b);
      const median = samples[Math.floor(samples.length / 2)]!;
      console.log(
        `runs-bench query samples(ms)=${samples.map((s) => s.toFixed(2)).join(", ")} median=${median.toFixed(2)} budget=${RUNS_1M_QUERY_BUDGET_MS}`,
      );
      expect(median).toBeLessThan(RUNS_1M_QUERY_BUDGET_MS);
    } finally {
      session.close();
    }
  });

  afterAll(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });
});
