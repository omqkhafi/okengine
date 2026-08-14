/**
 * Trace row right-slot: relative time on every run.
 */

import { describe, expect, test } from "bun:test";
import { relativeTime, traceRowMeta } from "./trace-row-meta.ts";

const NOW = 1_700_000_000_000;

describe("relativeTime", () => {
  test("formats the success-row clock", () => {
    expect(relativeTime(NOW - 500, NOW)).toBe("just now");
    expect(relativeTime(NOW - 23 * 60_000, NOW)).toBe("23m ago");
    expect(relativeTime(NOW - 2 * 3_600_000, NOW)).toBe("2h ago");
  });
});

describe("traceRowMeta", () => {
  test("failed run still shows relative time", () => {
    const meta = traceRowMeta(
      {
        error: "CycleClosed",
        errorMessage: "Cycle 24 is completed — issues cannot be added",
        startedAt: NOW - 23 * 60_000,
      },
      NOW,
    );
    expect(meta).toEqual({
      text: "23m ago",
      title: "CycleClosed — Cycle 24 is completed — issues cannot be added",
      failed: true,
    });
  });

  test("successful run shows relative time", () => {
    const meta = traceRowMeta(
      { error: null, errorMessage: null, startedAt: NOW - 23 * 60_000 },
      NOW,
    );
    expect(meta).toEqual({ text: "23m ago", title: "23m ago", failed: false });
  });
});
