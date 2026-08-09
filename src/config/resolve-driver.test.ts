/**
 * Driver map resolution — including `dev` → prod fallback.
 */

import { describe, expect, test } from "bun:test";
import { resolveDomainDdlMode, resolveDriverId } from "./index.ts";

describe("resolveDomainDdlMode", () => {
  test("test keeps ensure; prod always off", () => {
    expect(resolveDomainDdlMode("test", true)).toBe("ensure");
    expect(resolveDomainDdlMode("prod", true)).toBe("off");
  });

  test("dev follows autoPush", () => {
    expect(resolveDomainDdlMode("dev", true)).toBe("off");
    expect(resolveDomainDdlMode("dev", false)).toBe("ensure");
  });
});

describe("resolveDriverId", () => {
  test("reads the named env key", () => {
    expect(resolveDriverId({ dev: "postgres", prod: "postgres" }, "dev")).toBe("postgres");
    expect(resolveDriverId({ dev: "postgres", prod: "postgres" }, "prod")).toBe("postgres");
  });

  test("without defaults, cascade is env → dev → prod → test", () => {
    expect(resolveDriverId({ prod: "postgres" }, "dev")).toBe("postgres");
    expect(resolveDriverId({ test: "pglite" }, "dev")).toBe("pglite");
  });

  test("bare string expands to all envs", () => {
    expect(resolveDriverId("redis", "dev")).toBe("redis");
    expect(resolveDriverId("redis", "test")).toBe("redis");
    expect(resolveDriverId("redis", "prod")).toBe("redis");
  });
});
