/**
 * Unit tests for proportional waterfall bar math from real EffectEntry timing.
 */

import { describe, expect, test } from "bun:test";
import type { RunEffect } from "@/client.ts";
import { waterfallBars } from "./waterfall-bars.ts";

function effect(
  partial: Pick<RunEffect, "timestamp" | "duration"> & Partial<RunEffect>,
): RunEffect {
  return {
    kind: "read",
    resource: "sql:bookings",
    reversibility: "none",
    ...partial,
  };
}

describe("waterfallBars", () => {
  const startedAt = 1_000;
  const durationMs = 100;

  test("positions and sizes bars from real timestamps against the run window", () => {
    const bars = waterfallBars(
      [
        effect({ kind: "read", timestamp: 1_010, duration: 20 }),
        effect({ kind: "write", resource: "sql:bookings", timestamp: 1_040, duration: 30 }),
      ],
      startedAt,
      durationMs,
    );
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({
      index: 0,
      offsetRatio: 0.1,
      widthRatio: 0.2,
      startOffsetMs: 10,
      durationMs: 20,
    });
    expect(bars[1]).toMatchObject({
      index: 1,
      offsetRatio: 0.4,
      widthRatio: 0.3,
      startOffsetMs: 40,
      durationMs: 30,
    });
  });

  test("effect starting at time 0 sits at the left edge", () => {
    const bars = waterfallBars(
      [effect({ timestamp: startedAt, duration: 25 })],
      startedAt,
      durationMs,
    );
    expect(bars[0]?.offsetRatio).toBe(0);
    expect(bars[0]?.widthRatio).toBe(0.25);
  });

  test("effect ending exactly at durationMs fills to the right edge", () => {
    const bars = waterfallBars(
      [effect({ timestamp: startedAt + 40, duration: 60 })],
      startedAt,
      durationMs,
    );
    expect(bars[0]?.offsetRatio).toBe(0.4);
    expect(bars[0]?.widthRatio).toBe(0.6);
    expect((bars[0]?.offsetRatio ?? 0) + (bars[0]?.widthRatio ?? 0)).toBe(1);
  });

  test("overlapping effects keep independent positions", () => {
    const bars = waterfallBars(
      [
        effect({ kind: "read", timestamp: 1_010, duration: 50 }),
        effect({ kind: "write", resource: "sql:bookings", timestamp: 1_020, duration: 50 }),
      ],
      startedAt,
      durationMs,
    );
    expect(bars[0]?.offsetRatio).toBe(0.1);
    expect(bars[0]?.widthRatio).toBe(0.5);
    expect(bars[1]?.offsetRatio).toBe(0.2);
    expect(bars[1]?.widthRatio).toBe(0.5);
    // Overlap window [20, 60] exists for both
    expect(bars[0]!.offsetRatio + bars[0]!.widthRatio).toBeGreaterThan(bars[1]!.offsetRatio);
    expect(bars[1]!.offsetRatio + bars[1]!.widthRatio).toBeGreaterThan(bars[0]!.offsetRatio);
  });

  test("zero durationMs collapses every bar", () => {
    const bars = waterfallBars(
      [effect({ timestamp: startedAt, duration: 10 })],
      startedAt,
      0,
    );
    expect(bars[0]).toMatchObject({ offsetRatio: 0, widthRatio: 0, durationMs: 0 });
  });
});
