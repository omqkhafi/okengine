import { describe, expect, test } from "bun:test";
import { guardRunsQuerySql, RUNS_QUERY_ROW_LIMIT } from "./runs-query-guard.ts";

describe("guardRunsQuerySql", () => {
  test("allows SELECT / WITH / FROM / EXPLAIN / DESCRIBE", () => {
    expect(guardRunsQuerySql("SELECT id FROM runs LIMIT 10").ok).toBe(true);
    expect(guardRunsQuerySql("WITH x AS (SELECT 1 AS n) SELECT n FROM x").ok).toBe(true);
    expect(guardRunsQuerySql("FROM runs SELECT id LIMIT 5").ok).toBe(true);
    expect(guardRunsQuerySql("EXPLAIN SELECT 1").ok).toBe(true);
    expect(guardRunsQuerySql("DESCRIBE runs").ok).toBe(true);
  });

  test("injects LIMIT on unbounded SELECT/FROM/WITH", () => {
    const result = guardRunsQuerySql("SELECT id FROM runs");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.injectedLimit).toBe(true);
      expect(result.sql).toContain(`LIMIT ${RUNS_QUERY_ROW_LIMIT}`);
    }
  });

  test("does not inject LIMIT when one is present", () => {
    const result = guardRunsQuerySql("SELECT id FROM runs LIMIT 3");
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.injectedLimit).toBe(false);
  });

  test("rejects FROM-first filesystem reads", () => {
    const result = guardRunsQuerySql("FROM read_csv('/etc/passwd')");
    expect(result).toEqual({ ok: false, reason: "external:read_csv" });
  });

  test("rejects CTE-wrapped writes", () => {
    const result = guardRunsQuerySql("WITH x AS (SELECT 1 AS n) INSERT INTO runs SELECT * FROM x");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("keyword:insert");
  });

  test("rejects INSTALL / LOAD / ATTACH / PRAGMA / SET", () => {
    for (const sql of [
      "INSTALL httpfs",
      "LOAD httpfs",
      "ATTACH '/tmp/other.db'",
      "PRAGMA show_tables",
      "SET enable_external_access = true",
    ]) {
      const result = guardRunsQuerySql(sql);
      expect(result.ok).toBe(false);
    }
  });

  test("rejects read_parquet on an arbitrary path", () => {
    const result = guardRunsQuerySql("SELECT * FROM read_parquet('/tmp/other.parquet')");
    expect(result).toEqual({ ok: false, reason: "external:read_parquet" });
  });

  test("rejects COPY / CREATE / DELETE / EXPLAIN ANALYZE / multi-statement", () => {
    expect(guardRunsQuerySql("COPY runs TO '/tmp/out.csv'").ok).toBe(false);
    expect(guardRunsQuerySql("CREATE TABLE t AS SELECT 1").ok).toBe(false);
    expect(guardRunsQuerySql("DELETE FROM runs").ok).toBe(false);
    expect(guardRunsQuerySql("EXPLAIN ANALYZE SELECT 1")).toEqual({
      ok: false,
      reason: "explain-analyze",
    });
    expect(guardRunsQuerySql("SELECT 1; SELECT 2")).toEqual({
      ok: false,
      reason: "multi-statement",
    });
  });

  test("does not treat quoted INSERT as a write", () => {
    const result = guardRunsQuerySql("SELECT 'INSERT' AS label FROM runs LIMIT 1");
    expect(result.ok).toBe(true);
  });
});
