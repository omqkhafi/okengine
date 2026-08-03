/**
 * Default image pins derived from prod drivers.
 */

import { describe, expect, test } from "bun:test";
import {
  defaultImagesFromConfig,
  resolveImages,
  dockerDevDriverMismatches,
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

  test("clock postgres alone pulls store.sql image", () => {
    const images = defaultImagesFromConfig({
      drivers: {
        clock: { prod: "postgres" },
      },
    });
    expect(images).toEqual({
      "store.sql": "postgres:18-alpine",
    });
  });

  test("journal postgres alone pulls store.sql image", () => {
    const images = defaultImagesFromConfig({
      drivers: {
        journal: { prod: "postgres" },
      },
    });
    expect(images).toEqual({
      "store.sql": "postgres:18-alpine",
    });
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

describe("dockerDevDriverMismatches", () => {
  test("flags docker/prod sqlite/memory when containers are up", () => {
    const mismatches = dockerDevDriverMismatches(
      {
        drivers: {
          store: {
            sql: { local: "sqlite", docker: "sqlite", prod: "sqlite" },
            kv: { local: "memory", docker: "memory", prod: "memory" },
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

  test("silent when docker profile matches containers", () => {
    const mismatches = dockerDevDriverMismatches(
      {
        drivers: {
          store: {
            sql: { local: "sqlite", docker: "postgres", prod: "postgres" },
            kv: { local: "memory", docker: "redis", prod: "redis" },
          },
        },
      },
      ["store.sql", "store.kv"],
    );
    expect(mismatches).toEqual([]);
  });

  test("silent when only prod is set (docker falls back to prod)", () => {
    const mismatches = dockerDevDriverMismatches(
      {
        drivers: {
          store: {
            sql: { local: "sqlite", prod: "postgres" },
            kv: { local: "memory", prod: "redis" },
          },
        },
      },
      ["store.sql", "store.kv"],
    );
    expect(mismatches).toEqual([]);
  });
});
