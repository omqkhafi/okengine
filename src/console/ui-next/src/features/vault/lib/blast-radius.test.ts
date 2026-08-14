import { describe, expect, test } from "bun:test";
import { formatBlastRadius, formatDuration } from "./blast-radius.ts";

describe("formatBlastRadius", () => {
  test("empty", () => {
    const line = formatBlastRadius({
      count: 0,
      longestWakeAt: null,
      longestOutstandingMs: null,
      runIds: [],
    });
    expect(line.warn).toBe(false);
    expect(line.summary).toContain("No in-flight");
  });

  test("warns with count and duration", () => {
    const line = formatBlastRadius({
      count: 3,
      longestWakeAt: 1,
      longestOutstandingMs: 3_600_000,
      runIds: ["a", "b", "c"],
    });
    expect(line.warn).toBe(true);
    expect(line.summary).toContain("3");
    expect(line.detail).toContain("1h");
  });
});

describe("formatDuration", () => {
  test("units", () => {
    expect(formatDuration(500)).toBe("500ms");
    expect(formatDuration(5_000)).toBe("5s");
    expect(formatDuration(120_000)).toBe("2m");
  });
});
