/**
 * Unit tests for waterfall timeline ticks, idle gaps, and zoom viewport math.
 */

import { describe, expect, test } from "bun:test";
import type { RunEffect } from "@/client.ts";
import { waterfallBars } from "./waterfall-bars.ts";
import {
  mapToViewport,
  timelineTickOffsets,
  timelineTicksForView,
  timelineView,
  waterfallGaps,
  zoomInStep,
  zoomOutStep,
} from "./waterfall-timeline.ts";

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

describe("timelineTickOffsets", () => {
  test("always includes 0 and durationMs", () => {
    const ticks = timelineTickOffsets(100);
    expect(ticks[0]).toBe(0);
    expect(ticks[ticks.length - 1]).toBe(100);
    expect(ticks.length).toBeGreaterThanOrEqual(2);
  });

  test("zero duration collapses to a single tick", () => {
    expect(timelineTickOffsets(0)).toEqual([0]);
  });
});

describe("waterfallGaps", () => {
  const startedAt = 1_000;
  const durationMs = 100;

  test("reports idle time between non-overlapping effects", () => {
    const bars = waterfallBars(
      [
        effect({ timestamp: 1_000, duration: 20 }),
        effect({ kind: "write", resource: "sql:bookings", timestamp: 1_050, duration: 20 }),
      ],
      startedAt,
      durationMs,
    );
    const gaps = waterfallGaps(bars, durationMs);
    expect(gaps).toHaveLength(2);
    expect(gaps[0]).toMatchObject({ startOffsetMs: 20, durationMs: 30 });
    expect(gaps[1]).toMatchObject({ startOffsetMs: 70, durationMs: 30 });
  });

  test("overlapping effects produce no interior gap", () => {
    const bars = waterfallBars(
      [
        effect({ timestamp: 1_000, duration: 60 }),
        effect({ kind: "write", resource: "sql:bookings", timestamp: 1_020, duration: 50 }),
      ],
      startedAt,
      durationMs,
    );
    const gaps = waterfallGaps(bars, durationMs);
    expect(gaps.every((g) => g.startOffsetMs >= 70 || g.startOffsetMs === 0)).toBe(true);
    expect(gaps.some((g) => g.startOffsetMs > 0 && g.startOffsetMs < 70)).toBe(false);
  });

  test("leading idle before the first effect", () => {
    const bars = waterfallBars([effect({ timestamp: 1_040, duration: 20 })], startedAt, durationMs);
    const gaps = waterfallGaps(bars, durationMs);
    expect(gaps[0]).toMatchObject({ startOffsetMs: 0, durationMs: 40 });
  });
});

describe("timelineView + mapToViewport", () => {
  test("zoom 2 halves the visible window", () => {
    const view = timelineView(2, 0);
    expect(view.widthRatio).toBe(0.5);
    expect(view.startRatio).toBe(0);
  });

  test("maps a bar into the zoomed viewport", () => {
    const view = timelineView(2, 0.25);
    const mapped = mapToViewport(0.3, 0.2, view);
    expect(mapped).not.toBeNull();
    expect(mapped!.left).toBeCloseTo(0.1);
    expect(mapped!.width).toBeCloseTo(0.4);
  });

  test("returns null when the bar is fully outside the view", () => {
    const view = timelineView(2, 0.5);
    expect(mapToViewport(0, 0.2, view)).toBeNull();
  });
});

describe("timelineTicksForView", () => {
  test("labels stay inside the zoomed window", () => {
    const view = timelineView(2, 0);
    const ticks = timelineTicksForView(100, view);
    expect(ticks[0]?.offsetMs).toBe(0);
    expect(ticks[ticks.length - 1]?.offsetMs).toBe(50);
    expect(ticks[ticks.length - 1]?.viewRatio).toBe(1);
  });
});

describe("zoom steps", () => {
  test("steps through WATERFALL_ZOOM_STEPS", () => {
    expect(zoomInStep(1)).toBe(2);
    expect(zoomInStep(2)).toBe(4);
    expect(zoomInStep(8)).toBe(8);
    expect(zoomOutStep(4)).toBe(2);
    expect(zoomOutStep(1)).toBe(1);
  });
});
