/**
 * `defineConfig` fills missing `docker` pins from `prod` and normalizes legacy keys.
 */

import { describe, expect, test } from "bun:test";
import { defineConfig, fillDockerFromProd, normalizeEnvDriverMap } from "./index.ts";

describe("fillDockerFromProd / defineConfig", () => {
  test("copies prod onto docker when docker is omitted", () => {
    const filled = fillDockerFromProd({
      local: "sqlite",
      prod: "postgres",
    });
    expect(filled?.docker).toBe("postgres");
    expect(filled?.local).toBe("sqlite");
  });

  test("does not overwrite an explicit docker pin", () => {
    expect(
      fillDockerFromProd({
        local: "sqlite",
        docker: "memory",
        prod: "postgres",
      })?.docker,
    ).toBe("memory");
  });

  test("vault prod → docker copies the prod driver", () => {
    expect(fillDockerFromProd({ local: "dotenv", prod: "openbao" })?.docker).toBe("openbao");
  });

  test("defineConfig fills every element from prod", () => {
    const cfg = defineConfig({
      drivers: {
        store: {
          sql: { local: "sqlite", prod: "postgres" },
          kv: { local: "memory", prod: "redis" },
          files: { local: "fs", prod: "s3" },
        },
        signal: { local: "memory", prod: "postgres" },
        clock: { local: "memory", prod: "postgres" },
        vault: { local: "dotenv", prod: "openbao" },
        channel: {
          email: { local: "console", prod: "smtp" },
        },
        ai: { local: "mock", prod: "anthropic" },
      },
    });
    expect(cfg.drivers?.store?.sql?.docker).toBe("postgres");
    expect(cfg.drivers?.store?.kv?.docker).toBe("redis");
    expect(cfg.drivers?.store?.files?.docker).toBe("s3");
    expect(cfg.drivers?.signal?.docker).toBe("postgres");
    expect(cfg.drivers?.clock?.docker).toBe("postgres");
    expect(cfg.drivers?.vault?.docker).toBe("openbao");
    expect(cfg.drivers?.channel?.email?.docker).toBe("smtp");
    expect(cfg.drivers?.ai?.docker).toBe("anthropic");
  });

  test("normalizeEnvDriverMap maps legacy keys", () => {
    const normalized = normalizeEnvDriverMap({
      dev: "sqlite",
      stack: "postgres",
      prod: "postgres",
    });
    expect(normalized?.local).toBe("sqlite");
    expect(normalized?.docker).toBe("postgres");
    expect((normalized as { dev?: string } | undefined)?.dev).toBeUndefined();
    expect((normalized as { stack?: string } | undefined)?.stack).toBeUndefined();
  });

  test("defineConfig accepts legacy driver-map keys", () => {
    const cfg = defineConfig({
      drivers: {
        store: {
          sql: { dev: "sqlite", stack: "postgres", prod: "postgres" } as never,
        },
      },
    });
    expect(cfg.drivers?.store?.sql?.local).toBe("sqlite");
    expect(cfg.drivers?.store?.sql?.docker).toBe("postgres");
  });
});
