import { describe, expect, test } from "bun:test";
import { defineSeed, normalizeSeedFns, resolveSeedCategory, type SeedFn } from "./seed.ts";

describe("defineSeed / resolveSeedCategory", () => {
  test("defineSeed returns the same def", () => {
    const fn: SeedFn = async () => {};
    const def = defineSeed({ essential: fn, dev: [fn], prod: fn });
    expect(def.essential).toBe(fn);
    expect(def.dev).toEqual([fn]);
    expect(def.prod).toBe(fn);
  });

  test("normalizeSeedFns preserves array order", () => {
    const a: SeedFn = async () => {};
    const b: SeedFn = async () => {};
    expect(normalizeSeedFns([a, b])).toEqual([a, b]);
    expect(normalizeSeedFns(a)).toEqual([a]);
    expect(normalizeSeedFns()).toEqual([]);
  });

  test("resolveSeedCategory matches the env matrix", () => {
    expect(resolveSeedCategory("local")).toBe("dev");
    expect(resolveSeedCategory("docker")).toBe("dev");
    expect(resolveSeedCategory("prod")).toBe("prod");
    expect(resolveSeedCategory("test")).toBe(null);
  });
});
