/**
 * `defineConfig` fills missing `dev` pins from `prod` and normalizes legacy keys.
 */

import { describe, expect, test } from "bun:test";
import { defineConfig, fillDevFromProd, normalizeEnvDriverMap } from "./index.ts";

describe("fillDevFromProd / defineConfig", () => {
  test("copies prod onto dev when dev is omitted", () => {
    const filled = fillDevFromProd({
      test: "pglite",
      prod: "postgres",
    });
    expect(filled?.dev).toBe("postgres");
    expect(filled?.test).toBe("pglite");
  });

  test("does not overwrite an explicit dev pin", () => {
    expect(
      fillDevFromProd({
        dev: "memory",
        prod: "postgres",
      })?.dev,
    ).toBe("memory");
  });

  test("vault prod → dev copies the prod driver", () => {
    expect(fillDevFromProd({ prod: "vault" })?.dev).toBe("vault");
  });

  test("defineConfig fills every element from prod", () => {
    const cfg = defineConfig({
      drivers: {
        store: {
          sql: { test: "pglite", prod: "postgres" },
          kv: { test: "memory", prod: "redis" },
          files: { test: "memory", prod: "s3" },
        },
        signal: { test: "memory", prod: "redis" },
        clock: { test: "frozen", prod: "file" },
        vault: { test: "memory", prod: "vault" },
        channel: {
          email: { test: "console", prod: "smtp" },
        },
        ai: { test: "mock", prod: "anthropic" },
      },
    });
    expect(cfg.drivers?.store?.sql).toMatchObject({
      dev: "postgres",
      test: "pglite",
      prod: "postgres",
    });
    expect(cfg.drivers?.store?.kv).toMatchObject({
      dev: "redis",
      test: "memory",
      prod: "redis",
    });
    expect(cfg.drivers?.store?.files).toMatchObject({
      dev: "s3",
      test: "memory",
      prod: "s3",
    });
    expect(cfg.drivers?.signal).toMatchObject({
      dev: "redis",
      test: "memory",
      prod: "redis",
    });
    expect(cfg.drivers?.clock).toMatchObject({
      dev: "file",
      test: "frozen",
      prod: "file",
    });
    expect(cfg.drivers?.vault).toMatchObject({
      dev: "vault",
      test: "memory",
      prod: "vault",
    });
    expect(cfg.drivers?.channel?.email).toMatchObject({
      dev: "smtp",
      test: "console",
      prod: "smtp",
    });
    expect(cfg.drivers?.ai).toMatchObject({
      dev: "anthropic",
      test: "mock",
      prod: "anthropic",
    });
  });

  test("normalizeEnvDriverMap expands a bare string to all envs", () => {
    expect(normalizeEnvDriverMap("redis")).toEqual({
      dev: "redis",
      test: "redis",
      prod: "redis",
    });
  });

  test("normalizeEnvDriverMap keeps only dev/test/prod keys", () => {
    const normalized = normalizeEnvDriverMap({
      dev: "postgres",
      test: "pglite",
      prod: "postgres",
    });
    expect(normalized).toEqual({
      dev: "postgres",
      test: "pglite",
      prod: "postgres",
    });
  });

  test("defineConfig rejects sqlite", () => {
    expect(() =>
      defineConfig({
        drivers: {
          store: {
            sql: { dev: "sqlite", test: "pglite", prod: "postgres" },
          },
        },
      }),
    ).toThrow(/sqlite/);
  });

  test("defineConfig rejects libsql", () => {
    expect(() =>
      defineConfig({
        drivers: {
          store: {
            sql: { dev: "libsql", test: "pglite", prod: "postgres" },
          },
        },
      }),
    ).toThrow(/libsql/);
  });

  test("defineConfig rejects non-pglite test SQL", () => {
    expect(() =>
      defineConfig({
        drivers: {
          store: {
            sql: { dev: "postgres", test: "memory", prod: "postgres" },
          },
        },
      }),
    ).toThrow(/pglite/);
  });
});
