/**
 * `defineConfig` fills missing `stack` pins from `prod`.
 */

import { describe, expect, test } from "bun:test";
import { defineConfig, fillStackFromProd } from "./index.ts";

describe("fillStackFromProd / defineConfig", () => {
  test("copies prod onto stack when stack is omitted", () => {
    const filled = fillStackFromProd({
      dev: "sqlite",
      prod: "postgres",
    });
    expect(filled?.stack).toBe("postgres");
    expect(filled?.dev).toBe("sqlite");
  });

  test("does not overwrite an explicit stack pin", () => {
    expect(
      fillStackFromProd({
        dev: "sqlite",
        stack: "memory",
        prod: "postgres",
      })?.stack,
    ).toBe("memory");
  });

  test("vault sops → stack dotenv", () => {
    expect(
      fillStackFromProd({ dev: "dotenv", prod: "sops" }, { vault: true })
        ?.stack,
    ).toBe("dotenv");
  });

  test("defineConfig fills every element from prod", () => {
    const cfg = defineConfig({
      drivers: {
        store: {
          sql: { dev: "sqlite", prod: "postgres" },
          kv: { dev: "memory", prod: "redis" },
          files: { dev: "fs", prod: "s3" },
        },
        signal: { dev: "memory", prod: "postgres" },
        clock: { dev: "memory", prod: "postgres" },
        vault: { dev: "dotenv", prod: "sops" },
        channel: {
          email: { dev: "console", prod: "smtp" },
        },
        ai: { dev: "mock", prod: "anthropic" },
      },
    });
    expect(cfg.drivers?.store?.sql?.stack).toBe("postgres");
    expect(cfg.drivers?.store?.kv?.stack).toBe("redis");
    expect(cfg.drivers?.store?.files?.stack).toBe("s3");
    expect(cfg.drivers?.signal?.stack).toBe("postgres");
    expect(cfg.drivers?.clock?.stack).toBe("postgres");
    expect(cfg.drivers?.vault?.stack).toBe("dotenv");
    expect(cfg.drivers?.channel?.email?.stack).toBe("smtp");
    expect(cfg.drivers?.ai?.stack).toBe("anthropic");
  });
});
