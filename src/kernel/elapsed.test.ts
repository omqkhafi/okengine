/**
 * Unit tests for {@link resolveDurationMs}.
 */

import { describe, expect, test } from "bun:test";
import { resolveDurationMs } from "./elapsed.ts";

describe("resolveDurationMs", () => {
  test("prefers high-res when the wall clock did not tick", () => {
    expect(resolveDurationMs(0, 0.37)).toBe(0.37);
    expect(resolveDurationMs(0, 0)).toBe(0);
  });

  test("keeps the app clock when it ticked", () => {
    expect(resolveDurationMs(2, 2.4)).toBe(2);
    expect(resolveDurationMs(1, 0.4)).toBe(1);
    expect(resolveDurationMs(5_000, 3)).toBe(5_000);
    expect(resolveDurationMs(41, 0.2)).toBe(41);
  });

  test("non-finite and negative collapse to 0", () => {
    expect(resolveDurationMs(Number.NaN, 4)).toBe(4);
    expect(resolveDurationMs(4, Number.NaN)).toBe(4);
    expect(resolveDurationMs(-12, -3)).toBe(0);
  });
});
