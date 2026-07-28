/**
 * Driver map resolution — including `docker` → prod fallback.
 */

import { describe, expect, test } from "bun:test";
import { resolveDomainDdlMode, resolveDriverId } from "./index.ts";

describe("resolveDomainDdlMode", () => {
  test("test keeps ensure; docker/prod always off", () => {
    expect(resolveDomainDdlMode("test", true)).toBe("ensure");
    expect(resolveDomainDdlMode("docker", true)).toBe("off");
    expect(resolveDomainDdlMode("prod", true)).toBe("off");
  });

  test("local follows autoPush", () => {
    expect(resolveDomainDdlMode("local", true)).toBe("off");
    expect(resolveDomainDdlMode("local", false)).toBe("ensure");
  });
});

describe("resolveDriverId", () => {
  test("reads the named env key", () => {
    expect(resolveDriverId({ local: "sqlite", prod: "postgres" }, "local")).toBe("sqlite");
    expect(resolveDriverId({ local: "sqlite", prod: "postgres" }, "prod")).toBe("postgres");
  });

  test("docker prefers docker, then prod, then local", () => {
    expect(
      resolveDriverId({ local: "sqlite", docker: "postgres", prod: "postgres" }, "docker"),
    ).toBe("postgres");
    expect(resolveDriverId({ local: "sqlite", prod: "postgres" }, "docker")).toBe("postgres");
    expect(resolveDriverId({ local: "sqlite" }, "docker")).toBe("sqlite");
  });

  test("legacy keys resolve after normalize", () => {
    expect(resolveDriverId({ dev: "sqlite", stack: "postgres" } as never, "local")).toBe("sqlite");
    expect(resolveDriverId({ dev: "sqlite", stack: "postgres" } as never, "docker")).toBe(
      "postgres",
    );
  });
});
