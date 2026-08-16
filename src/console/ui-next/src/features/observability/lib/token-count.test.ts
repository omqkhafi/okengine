/**
 * Window token totals — empty when no stamped samples exist.
 */

import { describe, expect, test } from "bun:test";
import { formatTokenCount, formatTokenRail, tokenCountInWindow } from "./token-count.ts";
import { monitoringRun } from "./run-fixture.ts";

describe("tokenCountInWindow", () => {
  test("no token fields → honest empty", () => {
    const now = 1_000;
    const runs = [monitoringRun({ id: "a", flow: "x", startedAt: now - 10 })];
    expect(tokenCountInWindow(runs, now, 60_000)).toEqual({ kind: "empty" });
  });

  test("zero tokens are not a sample", () => {
    const now = 1_000;
    const runs = [
      monitoringRun({
        id: "a",
        flow: "x",
        startedAt: now - 10,
        inputTokens: 0,
        outputTokens: 0,
      }),
    ];
    expect(tokenCountInWindow(runs, now, 60_000)).toEqual({ kind: "empty" });
  });

  test("sums stamped tokens in the window", () => {
    const now = 1_000;
    const runs = [
      monitoringRun({
        id: "a",
        flow: "x",
        startedAt: now - 10,
        inputTokens: 12,
        outputTokens: 7,
      }),
      monitoringRun({
        id: "b",
        flow: "y",
        startedAt: now - 20,
        inputTokens: 4,
        outputTokens: null,
      }),
    ];
    expect(tokenCountInWindow(runs, now, 60_000)).toEqual({
      kind: "summary",
      inputTokens: 16,
      outputTokens: 7,
      windowMs: 60_000,
    });
  });
});

describe("formatTokenCount", () => {
  test("does not print zero as a placeholder", () => {
    expect(formatTokenCount(0)).toBe("—");
    expect(formatTokenCount(12)).toBe("12");
    expect(formatTokenCount(12400)).toBe("12.4k");
  });

  test("rail copy omits a missing side and never prints 0", () => {
    expect(
      formatTokenRail({ kind: "summary", inputTokens: 12, outputTokens: 7, windowMs: 60_000 }),
    ).toBe("12 in · 7 out");
    expect(
      formatTokenRail({ kind: "summary", inputTokens: 12, outputTokens: 0, windowMs: 60_000 }),
    ).toBe("12 in");
    expect(
      formatTokenRail({ kind: "summary", inputTokens: 0, outputTokens: 0, windowMs: 60_000 }),
    ).toBeNull();
  });
});
