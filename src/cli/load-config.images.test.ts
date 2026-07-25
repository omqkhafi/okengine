/**
 * Default image pins derived from prod drivers.
 */

import { describe, expect, test } from "bun:test";
import {
  defaultImagesFromConfig,
  resolveImages,
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
