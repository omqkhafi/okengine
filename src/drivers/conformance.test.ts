/**
 * Gate: driver conformance suite runs against every driver.
 */

import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  runFilesConformance,
  runIndexConformance,
  runKvConformance,
  runSqlConformance,
  runTextIndexConformance,
} from "./conformance.ts";
import { fsDriver } from "./fs.ts";
import { libsqlDriver, libsqlIndexDriver } from "./libsql.ts";
import { memoryFilesDriver, memoryIndexDriver, memoryKvDriver, memorySqlDriver } from "./memory.ts";
import { meilisearchDriver } from "./meilisearch.ts";
import { createMeilisearchFakeFetch } from "./meilisearch.test.ts";
import { pgliteDriver } from "./pglite.ts";
import { pgvectorDriver } from "./pgvector.ts";
import { createPostgresFakeClient, postgresDriver } from "./postgres.ts";
import { createRedisFakeClient, redisDriver } from "./redis.ts";
import { createS3FakeClient, s3Driver } from "./s3.ts";
import { sqliteDriver } from "./sqlite.ts";

describe("sql conformance", () => {
  test("memory", () => runSqlConformance(memorySqlDriver));
  test("sqlite", () => runSqlConformance(sqliteDriver, { url: ":memory:" }));
  test("libsql", () => runSqlConformance(libsqlDriver, { url: ":memory:" }));
  // pglite cold-starts WASM + extension load — slow disks / CI need > default 5s
  test("pglite", () => runSqlConformance(pgliteDriver, { url: "memory://" }), 15_000);
  test("postgres (fake Bun.SQL client)", () =>
    runSqlConformance(postgresDriver, {
      client: createPostgresFakeClient(),
    }));
});

describe("kv conformance", () => {
  test("memory", () => runKvConformance(memoryKvDriver));
  test("redis (fake Bun.redis client)", () =>
    runKvConformance(redisDriver, { client: createRedisFakeClient() }));
});

describe("files conformance", () => {
  test("memory", () => runFilesConformance(memoryFilesDriver));
  test("fs", async () => {
    const root = join(process.env.TMPDIR ?? "/tmp", `oke-fs-conf-${crypto.randomUUID()}`);
    await runFilesConformance(fsDriver, { root, name: "conf" });
  });
  test("s3 (fake Bun.S3 client)", () =>
    runFilesConformance(s3Driver, { client: createS3FakeClient() }));
});

describe("index conformance", () => {
  test("memory", () => runIndexConformance(memoryIndexDriver, { dims: 3 }));
  test("pgvector", () => runIndexConformance(pgvectorDriver, { dims: 3 }));
  test("libsql", () => runIndexConformance(libsqlIndexDriver, { dims: 3 }));
});

describe("text index conformance", () => {
  test("meilisearch (injected fetch)", () =>
    runTextIndexConformance(meilisearchDriver, {
      url: "http://127.0.0.1:7700",
      apiKey: "master-key",
      fetch: createMeilisearchFakeFetch(),
    }));
});

describe("protocol naming", () => {
  test("driver ids are protocols, never vendors", () => {
    const ids = [
      memorySqlDriver.id,
      sqliteDriver.id,
      libsqlDriver.id,
      pgliteDriver.id,
      postgresDriver.id,
      memoryKvDriver.id,
      redisDriver.id,
      memoryFilesDriver.id,
      fsDriver.id,
      s3Driver.id,
      memoryIndexDriver.id,
      pgvectorDriver.id,
      libsqlIndexDriver.id,
      meilisearchDriver.id,
    ];
    expect(ids).toEqual([
      "memory",
      "sqlite",
      "libsql",
      "pglite",
      "postgres",
      "memory",
      "redis",
      "memory",
      "fs",
      "s3",
      "memory",
      "pgvector",
      "libsql",
      "meilisearch",
    ]);
    for (const id of ids) {
      expect(id).not.toMatch(/neon|dragonfly|minio|upstash|cloudflare/i);
    }
  });
});
