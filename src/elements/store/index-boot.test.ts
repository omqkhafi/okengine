/**
 * End-to-end `store.index()` boot wiring — the CONFIGURED driver resolves at
 * real boot for every backend (memory / libsql / pgvector over pglite /
 * pgvector over real Postgres), SQL-backed indexes share store.sql's
 * already-open connection (never a second, redundant one), and search runs
 * through each engine's native ANN index — no JS-side full scan survives.
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  connectLibsql,
  libsqlDriver,
  libsqlIndexDriver,
  openLibsqlIndex,
} from "../../drivers/libsql.ts";
import { connectPglite } from "../../drivers/pglite.ts";
import { openPgvectorIndex } from "../../drivers/pgvector.ts";
import { connectPostgres } from "../../drivers/postgres.ts";
import type { SqlConnection, SqlDriver } from "../../drivers/types.ts";
import { bindStore } from "../../kernel/boot-bind/store.ts";
import {
  createStoreRuntime,
  index as declareIndex,
  sql as declareSql,
  type SqlStoreHandle,
  type VectorIndexStoreFxHandle,
} from "../store.ts";

const WRITE_CTX = (name: string) => ({
  effects: { reads: [`index:${name}` as const], writes: [`index:${name}` as const] },
});

const prev = {
  libsql: process.env.OKE_LIBSQL_URL,
  pglite: process.env.OKE_PGLITE_URL,
};

afterEach(() => {
  if (prev.libsql === undefined) delete process.env.OKE_LIBSQL_URL;
  else process.env.OKE_LIBSQL_URL = prev.libsql;
  if (prev.pglite === undefined) delete process.env.OKE_PGLITE_URL;
  else process.env.OKE_PGLITE_URL = prev.pglite;
});

/** Wrap a real connection so the SQL it executes can be asserted on. */
function recordingConn(conn: SqlConnection): { conn: SqlConnection; statements: string[] } {
  const statements: string[] = [];
  return {
    statements,
    conn: {
      driverId: conn.driverId,
      role: conn.role,
      query: (sql, params) => {
        statements.push(sql);
        return conn.query(sql, params);
      },
      exec: (sql, params) => {
        statements.push(sql);
        return conn.exec(sql, params);
      },
      close: () => conn.close(),
    },
  };
}

describe("store.index boot wiring — memory", () => {
  test("boot with no configured index driver resolves memory end to end", async () => {
    const kb = declareIndex("kb", { dims: 3 });
    const runtime = bindStore({ stores: [kb] }, "local", () => Date.now());
    const handle = (await runtime.open(kb, WRITE_CTX("kb"))) as VectorIndexStoreFxHandle;
    expect(handle.driverId).toBe("memory");
    await handle.upsert("near", [1, 0, 0]);
    await handle.upsert("far", [0, 1, 0]);
    const hits = await handle.search([1, 0, 0], 2);
    expect(hits[0]?.id).toBe("near");
    await runtime.close();
  });
});

describe("store.index boot wiring — libsql", () => {
  test("boot: sql=libsql + index=libsql resolves native ANN end to end", async () => {
    process.env.OKE_LIBSQL_URL = ":memory:";
    const kb = declareIndex("kb", { dims: 3 });
    const runtime = bindStore(
      {
        config: { drivers: { store: { sql: { local: "libsql" }, index: { local: "libsql" } } } },
        stores: [kb],
      },
      "local",
      () => Date.now(),
    );
    const handle = (await runtime.open(kb, WRITE_CTX("kb"))) as VectorIndexStoreFxHandle;
    expect(handle.driverId).toBe("libsql");

    await handle.upsert("near", [1, 0.1, 0], { label: "near" });
    await handle.upsert("far", [0, 1, 0]);
    await handle.upsert("farther", [-1, 0, 0]);
    const hits = await handle.search([1, 0, 0], 3);
    expect(hits.map((h: { id: string }) => h.id)).toEqual(["near", "far", "farther"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.meta).toEqual({ label: "near" });
    expect(await handle.delete("farther")).toBe(true);
    await runtime.close();
  });

  test("sql and index facets share one already-open libsql connection", async () => {
    let connects = 0;
    const countingLibsql: SqlDriver = {
      ...libsqlDriver,
      connect: async (opts) => {
        connects++;
        return libsqlDriver.connect(opts);
      },
    };
    const docs = declareSql("docs");
    const kb = declareIndex("kb", { dims: 3 });
    const runtime = createStoreRuntime({
      drivers: { sql: countingLibsql, index: libsqlIndexDriver },
      sql: { docs: { name: "docs", primary: { url: ":memory:" } } },
      index: { kb: { url: ":memory:" } },
    });
    // Index first: it must open the connection the sql facet then reuses.
    const idxHandle = (await runtime.open(kb, WRITE_CTX("kb"))) as VectorIndexStoreFxHandle;
    await idxHandle.upsert("a", [1, 0, 0]);
    const sqlHandle = (await runtime.open(docs, {
      effects: { reads: ["sql:docs"], writes: ["sql:docs"] },
    })) as SqlStoreHandle;
    await sqlHandle.raw("CREATE TABLE IF NOT EXISTS t_share (id TEXT)", []);
    expect(connects).toBe(1);
    await runtime.close();
  });

  test("libsql index searches through vector_top_k — real ANN, not a scan", async () => {
    const real = await connectLibsql({ url: ":memory:" });
    const { conn, statements } = recordingConn(real);
    const idx = await openLibsqlIndex({ name: "ann", dims: 3, sql: conn });
    await idx.upsert("x", [1, 0, 0]);
    await idx.upsert("y", [0, 1, 0]);
    const hits = await idx.search([1, 0, 0], 1);
    expect(hits[0]?.id).toBe("x");
    expect(statements.some((s) => s.includes("libsql_vector_idx"))).toBe(true);
    expect(statements.some((s) => s.includes("vector_top_k"))).toBe(true);
    const plan = await real.query(
      `EXPLAIN QUERY PLAN SELECT * FROM vector_top_k('oke_idx_ann_vec', vector32('[1,0,0]'), 1)`,
    );
    expect(JSON.stringify(plan)).toContain("vector_top_k");
    await idx.close();
    await real.close();
  });
});

describe("store.index boot wiring — pglite + pgvector", () => {
  test("boot: sql=pglite + index=pgvector resolves end to end", async () => {
    process.env.OKE_PGLITE_URL = "memory://";
    const kb = declareIndex("kb", { dims: 3 });
    const runtime = bindStore(
      {
        config: { drivers: { store: { sql: { local: "pglite" }, index: { local: "pgvector" } } } },
        stores: [kb],
      },
      "local",
      () => Date.now(),
    );
    const handle = (await runtime.open(kb, WRITE_CTX("kb"))) as VectorIndexStoreFxHandle;
    expect(handle.driverId).toBe("pgvector");

    await handle.upsert("near", [1, 0.1, 0], { label: "near" });
    await handle.upsert("far", [0, 1, 0]);
    await handle.upsert("farther", [-1, 0, 0]);
    const hits = await handle.search([1, 0, 0], 3);
    expect(hits.map((h: { id: string }) => h.id)).toEqual(["near", "far", "farther"]);
    expect(hits[0]!.score).toBeGreaterThan(hits[1]!.score);
    expect(hits[0]!.meta).toEqual({ label: "near" });
    expect(await handle.delete("farther")).toBe(true);
    await runtime.close();
  });

  test("pglite runs the shared pgvector HNSW path — real ANN, not a scan", async () => {
    const real = await connectPglite({ url: "memory://" });
    const { conn, statements } = recordingConn(real);
    const idx = await openPgvectorIndex({ name: "ann", dims: 3, sql: conn });
    await idx.upsert("a", [1, 0, 0]);
    await idx.upsert("b", [0, 1, 0]);
    const hits = await idx.search([1, 0, 0], 2);
    expect(hits[0]?.id).toBe("a");
    expect(statements.some((s) => s.includes("CREATE EXTENSION IF NOT EXISTS vector"))).toBe(true);
    expect(
      statements.some((s) => s.includes("USING hnsw") && s.includes("vector_cosine_ops")),
    ).toBe(true);
    expect(statements.some((s) => s.includes("<=>"))).toBe(true);
    const indexes = await real.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'oke_idx_ann'`,
    );
    expect(JSON.stringify(indexes)).toContain("USING hnsw");
    await idx.close();
    await real.close();
  });
});

describe("store.index boot wiring — fail loud", () => {
  test("pgvector index with memory sql driver throws — never silently memory", async () => {
    const kb = declareIndex("kb", { dims: 3 });
    const runtime = bindStore(
      {
        config: { drivers: { store: { sql: { local: "memory" }, index: { local: "pgvector" } } } },
        stores: [kb],
      },
      "local",
      () => Date.now(),
    );
    await expect(runtime.open(kb, WRITE_CTX("kb"))).rejects.toThrow(/cannot share sql driver/);
    await runtime.close();
  });

  test("libsql index with sqlite sql driver throws", async () => {
    const kb = declareIndex("kb", { dims: 3 });
    const runtime = bindStore(
      {
        config: { drivers: { store: { sql: { local: "sqlite" }, index: { local: "libsql" } } } },
        stores: [kb],
      },
      "local",
      () => Date.now(),
    );
    await expect(runtime.open(kb, WRITE_CTX("kb"))).rejects.toThrow(/cannot share sql driver/);
    await runtime.close();
  });

  test("meilisearch without OKE_STORE_INDEX_URL throws at bind — never sqlUrl, never memory", () => {
    const prev = process.env.OKE_STORE_INDEX_URL;
    delete process.env.OKE_STORE_INDEX_URL;
    try {
      const kb = declareIndex("kb");
      expect(() =>
        bindStore(
          { config: { drivers: { store: { index: { local: "meilisearch" } } } }, stores: [kb] },
          "local",
          () => Date.now(),
        ),
      ).toThrow(/OKE_STORE_INDEX_URL/);
    } finally {
      if (prev === undefined) delete process.env.OKE_STORE_INDEX_URL;
      else process.env.OKE_STORE_INDEX_URL = prev;
    }
  });

  test("meilisearch binds its own URL + key (never the sql connection)", async () => {
    const prevUrl = process.env.OKE_STORE_INDEX_URL;
    const prevKey = process.env.OKE_STORE_INDEX_KEY;
    process.env.OKE_STORE_INDEX_URL = "http://127.0.0.1:7700";
    process.env.OKE_STORE_INDEX_KEY = "master-key";
    try {
      const kb = declareIndex("kb");
      const runtime = bindStore(
        { config: { drivers: { store: { index: { local: "meilisearch" } } } }, stores: [kb] },
        "local",
        () => Date.now(),
      );
      // No live server in unit tests: opening must fail loud (unreachable),
      // proving the binding pointed at HTTP, not silently degraded to memory.
      await expect(runtime.open(kb, WRITE_CTX("kb"))).rejects.toThrow(/meilisearch index/);
      await runtime.close();
    } finally {
      if (prevUrl === undefined) delete process.env.OKE_STORE_INDEX_URL;
      else process.env.OKE_STORE_INDEX_URL = prevUrl;
      if (prevKey === undefined) delete process.env.OKE_STORE_INDEX_KEY;
      else process.env.OKE_STORE_INDEX_KEY = prevKey;
    }
  });
});

const PGVECTOR_URL = process.env.OKE_TEST_PGVECTOR_URL;
if (!PGVECTOR_URL) {
  console.log("skip: live pgvector e2e (OKE_TEST_PGVECTOR_URL not set)");
}
const liveTest = PGVECTOR_URL ? test : test.skip;

describe("store.index boot wiring — real Postgres pgvector", () => {
  liveTest("live Postgres runs real HNSW ANN, not a scan", async () => {
    const real = await connectPostgres({ url: PGVECTOR_URL });
    const { conn, statements } = recordingConn(real);
    const idx = await openPgvectorIndex({ name: "live", dims: 3, sql: conn });
    await idx.upsert("near", [1, 0.1, 0]);
    await idx.upsert("far", [0, 1, 0]);
    await idx.upsert("farther", [-1, 0, 0]);
    const hits = await idx.search([1, 0, 0], 3);
    expect(hits.map((h) => h.id)).toEqual(["near", "far", "farther"]);
    expect(statements.some((s) => s.includes("CREATE EXTENSION IF NOT EXISTS vector"))).toBe(true);
    expect(statements.some((s) => s.includes("USING hnsw"))).toBe(true);
    expect(statements.some((s) => s.includes("<=>"))).toBe(true);
    const indexes = await real.query(
      `SELECT indexdef FROM pg_indexes WHERE tablename = 'oke_idx_live'`,
    );
    expect(JSON.stringify(indexes)).toContain("USING hnsw");
    await idx.delete("farther");
    await idx.close();
    await real.close();
  });
});
