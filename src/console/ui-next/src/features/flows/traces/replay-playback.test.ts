/**
 * Unit tests for Replay playback mapping helpers.
 */

import { describe, expect, test } from "bun:test";
import type { Manifest } from "../../../../../../manifest/types.ts";
import {
  activeEffectIndexAt,
  activeNodeAt,
  barPlayed,
  playbackDurationMs,
  playbackNodeSteps,
} from "./replay-playback.ts";
import type { WaterfallBar } from "./waterfall-bars.ts";

function bar(index: number, offsetRatio: number): WaterfallBar {
  return {
    index,
    kind: "read",
    resource: "sql:bookings",
    startOffsetMs: offsetRatio * 100,
    durationMs: 10,
    offsetRatio,
    widthRatio: 0.1,
  };
}

const MANIFEST: Manifest = {
  app: "skyport",
  flows: {
    "bookings.create": {
      trigger: { http: { method: "POST", path: "/bookings" } },
      effects: { emits: ["order-placed"] },
    },
    "fulfillment.onOrder": {
      trigger: { signal: "order-placed" },
    },
  },
} as unknown as Manifest;

describe("playbackDurationMs", () => {
  test("stays within the snappy band", () => {
    expect(playbackDurationMs(0)).toBe(900);
    expect(playbackDurationMs(10)).toBe(700);
    expect(playbackDurationMs(200)).toBe(1200);
    expect(playbackDurationMs(10_000)).toBe(1600);
  });
});

describe("activeEffectIndexAt", () => {
  const bars = [bar(0, 0), bar(1, 0.3), bar(2, 0.7)];

  test("returns -1 before the first bar", () => {
    expect(activeEffectIndexAt([bar(0, 0.2)], 0.1)).toBe(-1);
  });

  test("returns the latest started bar", () => {
    expect(activeEffectIndexAt(bars, 0)).toBe(0);
    expect(activeEffectIndexAt(bars, 0.35)).toBe(1);
    expect(activeEffectIndexAt(bars, 1)).toBe(2);
  });
});

describe("barPlayed", () => {
  test("true once the playhead passes the bar start", () => {
    expect(barPlayed(bar(0, 0.3), 0.2)).toBe(false);
    expect(barPlayed(bar(0, 0.3), 0.3)).toBe(true);
    expect(barPlayed(bar(0, 0.3), 0.9)).toBe(true);
  });
});

describe("playbackNodeSteps", () => {
  test("interleaves the linking signal between chained flows", () => {
    const steps = playbackNodeSteps(new Set(["bookings.create", "fulfillment.onOrder"]), MANIFEST);
    expect(steps).toEqual([
      "flow:bookings.create",
      "signal:order-placed",
      "flow:fulfillment.onOrder",
    ]);
  });

  test("omits the signal step when no emit/consume pair is declared", () => {
    const steps = playbackNodeSteps(new Set(["bookings.create", "ops.nightlyReconcile"]), MANIFEST);
    expect(steps).toEqual(["flow:bookings.create", "flow:ops.nightlyReconcile"]);
  });
});

describe("activeNodeAt", () => {
  const steps = ["flow:a", "signal:s", "flow:b"];

  test("null for empty steps", () => {
    expect(activeNodeAt([], 0.5)).toBeNull();
  });

  test("maps progress onto ordered steps", () => {
    expect(activeNodeAt(steps, 0)).toBe("flow:a");
    expect(activeNodeAt(steps, 0.4)).toBe("signal:s");
    expect(activeNodeAt(steps, 0.9)).toBe("flow:b");
    expect(activeNodeAt(steps, 1)).toBe("flow:b");
  });
});
