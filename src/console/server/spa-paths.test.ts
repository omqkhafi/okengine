import { describe, expect, test } from "bun:test";
import { isConsoleSpaPath } from "./serve.ts";

describe("isConsoleSpaPath", () => {
  test("keeps the five Console pages", () => {
    expect(isConsoleSpaPath("/")).toBe(true);
    expect(isConsoleSpaPath("/overview")).toBe(true);
    expect(isConsoleSpaPath("/flows")).toBe(true);
    expect(isConsoleSpaPath("/store")).toBe(true);
    expect(isConsoleSpaPath("/vault")).toBe(true);
  });

  test("unknown paths are not SPA pages", () => {
    expect(isConsoleSpaPath("/units")).toBe(false);
    expect(isConsoleSpaPath("/dashboard")).toBe(false);
    expect(isConsoleSpaPath("/overview/")).toBe(false);
  });
});
