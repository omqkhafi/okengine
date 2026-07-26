/**
 * Store binder — stack profile (+ env overrides).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { resolveKvDriverId, resolveSqlDriverId } from "./store.ts";

describe("bindStore driver resolution", () => {
  const prev = {
    stack: process.env.OKE_STACK,
    sql: process.env.OKE_SQL_DRIVER,
    kv: process.env.OKE_KV_DRIVER,
  };

  afterEach(() => {
    if (prev.stack === undefined) delete process.env.OKE_STACK;
    else process.env.OKE_STACK = prev.stack;
    if (prev.sql === undefined) delete process.env.OKE_SQL_DRIVER;
    else process.env.OKE_SQL_DRIVER = prev.sql;
    if (prev.kv === undefined) delete process.env.OKE_KV_DRIVER;
    else process.env.OKE_KV_DRIVER = prev.kv;
  });

  test("dev env keeps sqlite / memory from config", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { dev: "sqlite", stack: "postgres", prod: "postgres" },
            kv: { dev: "memory", stack: "redis", prod: "redis" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "dev", false)).toBe("sqlite");
    expect(resolveKvDriverId(options, "dev", false)).toBe("memory");
  });

  test("stack env uses stack profile (falls back to prod)", () => {
    const options = {
      config: {
        drivers: {
          store: {
            sql: { dev: "sqlite", stack: "postgres", prod: "postgres" },
            kv: { dev: "memory", prod: "redis" },
          },
        },
      },
    };
    expect(resolveSqlDriverId(options, "stack", true)).toBe("postgres");
    expect(resolveKvDriverId(options, "stack", true)).toBe("redis");
  });

  test("stack mode honours OKE_*_DRIVER overrides", () => {
    process.env.OKE_SQL_DRIVER = "postgres";
    process.env.OKE_KV_DRIVER = "redis";
    expect(resolveSqlDriverId({}, "stack", true)).toBe("postgres");
    expect(resolveKvDriverId({}, "stack", true)).toBe("redis");
  });
});
