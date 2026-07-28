/**
 * `defineConfig` fills missing `docker` pins from `prod`.
 */

import { describe, expect, test } from "bun:test";
import { defineConfig, fillDockerFromProd } from "./index.ts";

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

  test("vault sops → docker sops (prod parity)", () => {
    expect(
      fillDockerFromProd({ local: "dotenv", prod: "sops" })?.docker,
    ).toBe("sops");
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
        vault: { local: "dotenv", prod: "sops" },
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
    expect(cfg.drivers?.vault?.docker).toBe("sops");
    expect(cfg.drivers?.channel?.email?.docker).toBe("smtp");
    expect(cfg.drivers?.ai?.docker).toBe("anthropic");
  });

  test("defineConfig normalizes legacy dev/stack keys", () => {
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
