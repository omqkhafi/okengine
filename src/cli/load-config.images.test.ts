/**
 * Default image pins derived from prod drivers.
 */

import { describe, expect, test } from "bun:test";
import {
  defaultImagesFromConfig,
  resolveImages,
  stackDevDriverMismatches,
} from "./load-config.ts";

describe("defaultImagesFromConfig", () => {
  test("maps postgres + redis prod drivers", () => {
    const images = defaultImagesFromConfig({
      drivers: {
        store: {
          sql: { prod: "postgres" },
          kv: { prod: "redis" },
        },
      },
    });
    expect(images).toEqual({
      "store.sql": "postgres:18-alpine",
      "store.kv": "redis:8-alpine",
    });
  });

  test("prefers pgvector image when index uses pgvector", () => {
    const images = defaultImagesFromConfig({
      drivers: {
        store: {
          sql: { prod: "postgres" },
          index: { prod: "pgvector" },
        },
      },
    });
    expect(images["store.sql"]).toBe("pgvector/pgvector:pg17");
  });

  test("returns empty when no container drivers", () => {
    expect(defaultImagesFromConfig({})).toEqual({});
    expect(
      defaultImagesFromConfig({
        drivers: { store: { sql: { prod: "sqlite" } } },
      }),
    ).toEqual({});
  });
});

describe("resolveImages", () => {
  test("explicit images win over defaults", () => {
    const images = resolveImages({
      drivers: {
        store: {
          sql: { prod: "postgres" },
          kv: { prod: "redis" },
        },
      },
      images: { "store.sql": "pgvector/pgvector:pg17" },
    });
    expect(images).toEqual({ "store.sql": "pgvector/pgvector:pg17" });
  });

  test("falls back to driver defaults when images omitted", () => {
    const images = resolveImages({
      drivers: {
        store: {
          sql: { prod: "postgres" },
          kv: { prod: "redis" },
        },
      },
    });
    expect(images["store.sql"]).toBe("postgres:18-alpine");
    expect(images["store.kv"]).toBe("redis:8-alpine");
  });
});

describe("stackDevDriverMismatches", () => {
  test("flags stack/prod sqlite/memory when containers are up", () => {
    const mismatches = stackDevDriverMismatches(
      {
        drivers: {
          store: {
            sql: { dev: "sqlite", stack: "sqlite", prod: "sqlite" },
            kv: { dev: "memory", stack: "memory", prod: "memory" },
          },
        },
      },
      ["store.sql", "store.kv"],
    );
    expect(mismatches).toEqual([
      { label: "sql", using: "sqlite", container: "postgres" },
      { label: "kv", using: "memory", container: "redis" },
    ]);
  });

  test("silent when stack profile matches containers", () => {
    const mismatches = stackDevDriverMismatches(
      {
        drivers: {
          store: {
            sql: { dev: "sqlite", stack: "postgres", prod: "postgres" },
            kv: { dev: "memory", stack: "redis", prod: "redis" },
          },
        },
      },
      ["store.sql", "store.kv"],
    );
    expect(mismatches).toEqual([]);
  });

  test("silent when only prod is set (stack falls back to prod)", () => {
    const mismatches = stackDevDriverMismatches(
      {
        drivers: {
          store: {
            sql: { dev: "sqlite", prod: "postgres" },
            kv: { dev: "memory", prod: "redis" },
          },
        },
      },
      ["store.sql", "store.kv"],
    );
    expect(mismatches).toEqual([]);
  });
});
