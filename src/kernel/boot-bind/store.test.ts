/**
 * Store binder — docker profile (+ env overrides).
 */

import { afterEach, describe, expect, test } from "bun:test";
import {
  indexDriverFor,
  resolveFilesDriverId,
  resolveIndexDriverId,
  resolveKvDriverId,
  resolveSqlDriverId,
} from "./store.ts";

describe("bindStore driver resolution", () => {
  const prev = {
    docker: process.env.OKE_DOCKER,
    sql: process.env.OKE_SQL_DRIVER,
    kv: process.env.OKE_KV_DRIVER,
    files: process.env.OKE_FILES_DRIVER,
    index: process.env.OKE_INDEX_DRIVER,
  };

  afterEach(() => {
    if (prev.docker === undefined) delete process.env.OKE_DOCKER;
    else process.env.OKE_DOCKER = prev.docker;
    if (prev.sql === undefined) delete process.env.OKE_SQL_DRIVER;
    else process.env.OKE_SQL_DRIVER = prev.sql;
    if (prev.kv === undefined) delete process.env.OKE_KV_DRIVER;
    else process.env.OKE_KV_DRIVER = prev.kv;
    if (prev.files === undefined) delete process.env.OKE_FILES_DRIVER;
    else process.env.OKE_FILES_DRIVER = prev.files;
    if (prev.index === undefined) delete process.env.OKE_INDEX_DRIVER;
    else process.env.OKE_INDEX_DRIVER = prev.index;
  });

  test("local env keeps sqlite / memory from config", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { local: "sqlite", docker: "postgres", prod: "postgres" },
            kv: { local: "memory", docker: "redis", prod: "redis" },
            files: { local: "fs", docker: "s3", prod: "s3" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "local", false)).toBe("sqlite");
    expect(resolveKvDriverId(options, "local", false)).toBe("memory");
    expect(resolveFilesDriverId(options, "local", false)).toBe("fs");
  });

  test("docker env uses docker profile (falls back to prod)", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { local: "sqlite", docker: "postgres", prod: "postgres" },
            kv: { local: "memory", prod: "redis" },
            files: { local: "fs", prod: "s3" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "docker", true)).toBe("postgres");
    expect(resolveKvDriverId(options, "docker", true)).toBe("redis");
    expect(resolveFilesDriverId(options, "docker", true)).toBe("s3");
  });

  test("docker mode honours OKE_*_DRIVER overrides", () => {
    process.env.OKE_SQL_DRIVER = "postgres";
    process.env.OKE_KV_DRIVER = "redis";
    process.env.OKE_FILES_DRIVER = "s3";
    expect(resolveSqlDriverId({}, "docker", true)).toBe("postgres");
    expect(resolveKvDriverId({}, "docker", true)).toBe("redis");
    expect(resolveFilesDriverId({}, "docker", true)).toBe("s3");
  });
});

describe("bindStore index driver resolution", () => {
  const prevIndex = process.env.OKE_INDEX_DRIVER;

  afterEach(() => {
    if (prevIndex === undefined) delete process.env.OKE_INDEX_DRIVER;
    else process.env.OKE_INDEX_DRIVER = prevIndex;
  });

  test("defaults to memory when no index driver is configured", () => {
    expect(resolveIndexDriverId({}, "local", false)).toBe("memory");
    expect(resolveIndexDriverId({}, "docker", true)).toBe("memory");
    expect(indexDriverFor("memory").id).toBe("memory");
  });

  test("config drivers.store.index is honoured per env", () => {
    const options = {
      config: {
        drivers: {
          store: {
            index: { local: "memory", docker: "pgvector", prod: "pgvector" },
          },
        },
      },
    };
    expect(resolveIndexDriverId(options, "local", false)).toBe("memory");
    expect(resolveIndexDriverId(options, "docker", true)).toBe("pgvector");
    expect(resolveIndexDriverId(options, "prod", false)).toBe("pgvector");
  });

  test("libsql resolves from config", () => {
    const options = {
      config: { drivers: { store: { index: { local: "libsql" } } } },
    };
    expect(resolveIndexDriverId(options, "local", false)).toBe("libsql");
    expect(indexDriverFor("libsql").id).toBe("libsql");
  });

  test("docker mode honours OKE_INDEX_DRIVER override", () => {
    process.env.OKE_INDEX_DRIVER = "pgvector";
    expect(resolveIndexDriverId({}, "docker", true)).toBe("pgvector");
    expect(resolveIndexDriverId({}, "local", false)).toBe("memory");
  });

  test("indexDriverFor returns the configured driver and throws on unknown ids", () => {
    expect(indexDriverFor("pgvector").id).toBe("pgvector");
    expect(() => indexDriverFor("chroma")).toThrow(/unknown index driver "chroma"/);
  });
});
