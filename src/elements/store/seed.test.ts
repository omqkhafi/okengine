import { describe, expect, test } from "bun:test";
import {
  defineSeed,
  normalizeSeedFns,
  resolveSeedCategory,
  resolveSeedIdentity,
  seedPromptMessage,
  type SeedFn,
} from "./seed.ts";

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
    expect(resolveSeedCategory("dev")).toBe("dev");
    expect(resolveSeedCategory("prod")).toBe("prod");
    expect(resolveSeedCategory("test")).toBe(null);
  });

  test("resolveSeedIdentity prefers defineSeed name over the folder", () => {
    expect(
      resolveSeedIdentity({ name: "keel", description: "Featured Harbor story" }, "/tmp/app"),
    ).toEqual({
      name: "keel",
      description: "Featured Harbor story",
    });
    expect(resolveSeedIdentity(undefined, "/repo/examples/keel")).toEqual({ name: "keel" });
    expect(seedPromptMessage({ name: "keel", description: "Featured Harbor story" })).toBe(
      "Seed keel (Featured Harbor story)?",
    );
    expect(seedPromptMessage({ name: "notes" })).toBe("Seed notes?");
  });
});
