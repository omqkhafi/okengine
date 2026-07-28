/**
 * Store binder — docker profile (+ env overrides).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { resolveKvDriverId, resolveSqlDriverId } from "./store.ts";

describe("bindStore driver resolution", () => {
  const prev = {
    docker: process.env.OKE_DOCKER,
    sql: process.env.OKE_SQL_DRIVER,
    kv: process.env.OKE_KV_DRIVER,
  };

  afterEach(() => {
    if (prev.docker === undefined) delete process.env.OKE_DOCKER;
    else process.env.OKE_DOCKER = prev.docker;
    if (prev.sql === undefined) delete process.env.OKE_SQL_DRIVER;
    else process.env.OKE_SQL_DRIVER = prev.sql;
    if (prev.kv === undefined) delete process.env.OKE_KV_DRIVER;
    else process.env.OKE_KV_DRIVER = prev.kv;
  });

  test("local env keeps sqlite / memory from config", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { local: "sqlite", docker: "postgres", prod: "postgres" },
            kv: { local: "memory", docker: "redis", prod: "redis" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "local", false)).toBe("sqlite");
    expect(resolveKvDriverId(options, "local", false)).toBe("memory");
  });

  test("docker env uses docker profile (falls back to prod)", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { local: "sqlite", docker: "postgres", prod: "postgres" },
            kv: { local: "memory", prod: "redis" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "docker", true)).toBe("postgres");
    expect(resolveKvDriverId(options, "docker", true)).toBe("redis");
  });

  test("docker mode honours OKE_*_DRIVER overrides", () => {
    process.env.OKE_SQL_DRIVER = "postgres";
    process.env.OKE_KV_DRIVER = "redis";
    expect(resolveSqlDriverId({}, "docker", true)).toBe("postgres");
    expect(resolveKvDriverId({}, "docker", true)).toBe("redis");
  });
});
