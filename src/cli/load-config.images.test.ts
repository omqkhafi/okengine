/**
 * Default image pins derived from prod drivers.
 */

import { describe, expect, test } from "bun:test";
import { flattenImagesConfig } from "../config/index.ts";
import {
  defaultImagesFromConfig,
  resolveImages,
  dockerDevDriverMismatches,
} from "./load-config.ts";

describe("flattenImagesConfig", () => {
  test("flattens store/channel nesting to dotted keys; flat roles pass through", () => {
    expect(
      flattenImagesConfig({
        store: { sql: "postgres:18-alpine", kv: "redis:8-alpine", files: "rustfs/rustfs:1.0.0" },
        channel: { email: "axllent/mailpit:v1.22.3" },
        vault: "openbao/openbao:2.6.1",
        ai: "ollama/ollama:0.32.6",
        pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
        proxy: "caddy:2-alpine",
      }),
    ).toEqual({
      "store.sql": "postgres:18-alpine",
      "store.kv": "redis:8-alpine",
      "store.files": "rustfs/rustfs:1.0.0",
      "channel.email": "axllent/mailpit:v1.22.3",
      vault: "openbao/openbao:2.6.1",
      ai: "ollama/ollama:0.32.6",
      pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
      proxy: "caddy:2-alpine",
    });
  });

  test("undefined / empty input yields empty map", () => {
    expect(flattenImagesConfig(undefined)).toEqual({});
    expect(flattenImagesConfig({})).toEqual({});
  });
});

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
      pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
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
    expect(images.pgdog).toBe("ghcr.io/pgdogdev/pgdog:v0.1.51");
  });

  test("clock postgres alone pulls store.sql image", () => {
    const images = defaultImagesFromConfig({
      drivers: {
        clock: { prod: "postgres" },
      },
    });
    expect(images).toEqual({
      "store.sql": "postgres:18-alpine",
      pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
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
      pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
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
      images: { store: { sql: "pgvector/pgvector:pg17" } },
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
