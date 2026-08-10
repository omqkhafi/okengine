/**
 * Unit tests for {@link formatDuration} — three unit ranges + boundaries.
 */

import { describe, expect, test } from "bun:test";
import { formatDuration } from "./format-duration.ts";

describe("formatDuration", () => {
  test("microseconds for sub-millisecond runs", () => {
    expect(formatDuration(0)).toBe("0μs");
    expect(formatDuration(0.001)).toBe("1μs");
    expect(formatDuration(0.974)).toBe("974μs");
    expect(formatDuration(0.999)).toBe("999μs");
  });

  test("milliseconds for the normal range", () => {
    expect(formatDuration(1)).toBe("1ms");
    expect(formatDuration(12)).toBe("12ms");
    expect(formatDuration(56.2)).toBe("56.2ms");
    expect(formatDuration(56.24)).toBe("56.2ms");
    expect(formatDuration(999)).toBe("999ms");
    expect(formatDuration(999.94)).toBe("999.9ms");
  });

  test("seconds for slow runs", () => {
    expect(formatDuration(1_000)).toBe("1s");
    expect(formatDuration(1_700)).toBe("1.7s");
    expect(formatDuration(12_340)).toBe("12.3s");
    expect(formatDuration(60_000)).toBe("60s");
  });

  test("boundary values at unit transitions", () => {
    expect(formatDuration(0.5)).toBe("500μs");
    expect(formatDuration(1 - Number.EPSILON)).toBe("1000μs");
    expect(formatDuration(1)).toBe("1ms");
    expect(formatDuration(999.95)).toBe("1000ms");
    expect(formatDuration(1_000)).toBe("1s");
    expect(formatDuration(1_049)).toBe("1s");
    expect(formatDuration(1_050)).toBe("1.1s");
  });

  test("non-finite and negative collapse to 0μs", () => {
    expect(formatDuration(Number.NaN)).toBe("0μs");
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBe("0μs");
    expect(formatDuration(-12)).toBe("0μs");
  });
});
