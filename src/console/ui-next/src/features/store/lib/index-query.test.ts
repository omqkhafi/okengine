import { describe, expect, test } from "bun:test";
import { isProbeVector, parseIndexQuery, parseVector } from "./index-query.ts";

describe("parseVector", () => {
  test("parses comma or space separated numbers", () => {
    expect(parseVector("1, 0, 0")).toEqual([1, 0, 0]);
    expect(parseVector("0.1 0.2 0.3")).toEqual([0.1, 0.2, 0.3]);
  });

  test("rejects words", () => {
    expect(parseVector("pulse graph")).toBeNull();
  });
});

describe("isProbeVector", () => {
  test("requires two or more numeric tokens", () => {
    expect(isProbeVector("1, 0, 0")).toBe(true);
    expect(isProbeVector("1")).toBe(false);
    expect(isProbeVector("ENG-184")).toBe(false);
  });
});

describe("parseIndexQuery", () => {
  test("empty, text, and vector", () => {
    expect(parseIndexQuery("")).toEqual({ kind: "empty" });
    expect(parseIndexQuery("pulse graph")).toEqual({ kind: "text", q: "pulse graph" });
    expect(parseIndexQuery("1, 0, 0")).toEqual({ kind: "vector", vector: [1, 0, 0] });
    expect(parseIndexQuery("ENG-184")).toEqual({ kind: "text", q: "ENG-184" });
  });
});
