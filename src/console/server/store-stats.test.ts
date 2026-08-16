/**
 * Store SQL engine telemetry — structured errors, lock-text collapse, KPIs.
 */

import { describe, expect, test } from "bun:test";
import { defineTable } from "../../elements/store.ts";
import type { Manifest } from "../../manifest/types.ts";
import {
  assertAdviseQuery,
  classifyPgStatStatementsError,
  computeStatsKpis,
  maskLockActivityQuery,
  PG_STAT_STATEMENTS_NOT_CREATED,
  PG_STAT_STATEMENTS_NOT_PRELOADED,
  PG_STAT_STATEMENTS_UNSUPPORTED,
  queryStoreSqlLocks,
  queryStoreSqlStats,
  STORE_SQL_LOCK_QUERY_REDACTED,
  STORE_SQL_STATS_PII_GAP,
  StoreSqlStatsError,
} from "./store-stats.ts";
import { createManifestStoreRuntime } from "./store.ts";

const MANIFEST: Manifest = {
  oke: "1.0",
  app: "store-stats-test",
  flows: {},
  stores: {
    db: {
      facet: "sql",
      tables: { bookings: {} },
    },
  },
};

describe("classifyPgStatStatementsError", () => {
  test("PgStatStatementsNotPreloaded is structured — not a generic 500", () => {
    const err = classifyPgStatStatementsError(
      new Error('pg_stat_statements must be loaded via shared_preload_libraries'),
    );
    expect(err).toBeInstanceOf(StoreSqlStatsError);
    expect(err.code).toBe(PG_STAT_STATEMENTS_NOT_PRELOADED);
    expect(err.code).not.toBe("StoreNotFound");
  });

  test("must be preloaded wording maps to the same code", () => {
    expect(
      classifyPgStatStatementsError(new Error("extension \"pg_stat_statements\" must be preloaded"))
        .code,
    ).toBe(PG_STAT_STATEMENTS_NOT_PRELOADED);
  });

  test("Cockroach unimplemented is unsupported", () => {
    expect(
      classifyPgStatStatementsError(
        new Error('unimplemented: extension "pg_stat_statements" is not yet supported'),
      ).code,
    ).toBe(PG_STAT_STATEMENTS_UNSUPPORTED);
  });

  test("missing relation is not-created (CREATE EXTENSION still possible)", () => {
    expect(
      classifyPgStatStatementsError(
        new Error('relation "pg_stat_statements" does not exist'),
      ).code,
    ).toBe(PG_STAT_STATEMENTS_NOT_CREATED);
  });
});

describe("maskLockActivityQuery", () => {
  test("collapses live activity text by default", () => {
    expect(maskLockActivityQuery("update orders set email = 'a@oke.com'", false)).toBe(
      STORE_SQL_LOCK_QUERY_REDACTED,
    );
  });

  test("reveal returns the live query (audited path)", () => {
    const sql = "update orders set email = 'a@oke.com'";
    expect(maskLockActivityQuery(sql, true)).toBe(sql);
  });

  test("null stays null", () => {
    expect(maskLockActivityQuery(null, false)).toBeNull();
    expect(maskLockActivityQuery(null, true)).toBeNull();
  });
});

describe("computeStatsKpis", () => {
  test("slow / cache hit / avg rows from statement rows", () => {
    const kpis = computeStatsKpis([
      {
        queryid: "1",
        query: "SELECT $1",
        calls: 10,
        totalExecMs: 2000,
        meanExecMs: 200,
        minExecMs: 10,
        maxExecMs: 400,
        rows: 50,
        sharedBlksHit: 90,
        sharedBlksRead: 10,
        cacheHitRate: 0.9,
      },
      {
        queryid: "2",
        query: "SELECT 1",
        calls: 10,
        totalExecMs: 50,
        meanExecMs: 5,
        minExecMs: 1,
        maxExecMs: 9,
        rows: 10,
        sharedBlksHit: 10,
        sharedBlksRead: 0,
        cacheHitRate: 1,
      },
    ]);
    expect(kpis.slowQueries).toBe(1);
    expect(kpis.cacheHitRate).toBeCloseTo(0.91, 2);
    expect(kpis.avgRowsPerCall).toBe(3);
  });
});

describe("queryStoreSqlStats / locks on memory SQL", () => {
  test("memory driver is structured unsupported", async () => {
    const runtime = await createManifestStoreRuntime(MANIFEST);
    const bookings = defineTable("bookings", { id: true });
    const { sql: declareSql } = await import("../../elements/store.ts");
    runtime.register(declareSql("db", { schema: { bookings } }));
    try {
      await queryStoreSqlStats(runtime, "sql:db");
      throw new Error("expected unsupported");
    } catch (err) {
      expect(err).toBeInstanceOf(StoreSqlStatsError);
      expect((err as StoreSqlStatsError).code).toBe(PG_STAT_STATEMENTS_UNSUPPORTED);
    }
    try {
      await queryStoreSqlLocks(runtime, "sql:db");
      throw new Error("expected unsupported");
    } catch (err) {
      expect(err).toBeInstanceOf(StoreSqlStatsError);
      expect((err as StoreSqlStatsError).code).toBe(PG_STAT_STATEMENTS_UNSUPPORTED);
    }
    await runtime.close();
  });
});

describe("StoreSqlStatsQueryTextGap", () => {
  test("limitation name is stable for docs and UI", () => {
    expect(STORE_SQL_STATS_PII_GAP).toBe("StoreSqlStatsQueryTextGap");
  });
});

describe("assertAdviseQuery", () => {
  test("strips a trailing semicolon", () => {
    expect(assertAdviseQuery("SELECT id FROM bookings;")).toBe("SELECT id FROM bookings");
  });

  test("rejects a second statement", () => {
    expect(() => assertAdviseQuery("SELECT 1; DROP TABLE bookings")).toThrow(StoreSqlStatsError);
    try {
      assertAdviseQuery("SELECT 1; DROP TABLE bookings");
    } catch (err) {
      expect((err as StoreSqlStatsError).code).toBe(PG_STAT_STATEMENTS_NOT_CREATED);
    }
  });
});
