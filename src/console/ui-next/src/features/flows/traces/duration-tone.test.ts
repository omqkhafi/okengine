/**
 * Unit tests for duration cool→hot shading bands.
 */

import { describe, expect, test } from "bun:test";
import {
  DURATION_THRESHOLD_OPTIONS,
  durationClassName,
  durationThresholdDotClass,
  durationTone,
  durationToneDotClass,
  type DurationTone,
} from "./duration-tone.ts";

describe("durationTone", () => {
  test("ladders through every band", () => {
    const samples: ReadonlyArray<{ readonly ms: number; readonly tone: DurationTone }> = [
      { ms: 0, tone: "fast" },
      { ms: 9.9, tone: "fast" },
      { ms: 10, tone: "good" },
      { ms: 49, tone: "good" },
      { ms: 50, tone: "ok" },
      { ms: 99, tone: "ok" },
      { ms: 100, tone: "elevated" },
      { ms: 249, tone: "elevated" },
      { ms: 250, tone: "warn" },
      { ms: 499, tone: "warn" },
      { ms: 500, tone: "slow" },
      { ms: 999, tone: "slow" },
      { ms: 1_000, tone: "bad" },
      { ms: 4_999, tone: "bad" },
      { ms: 5_000, tone: "critical" },
      { ms: 60_000, tone: "critical" },
    ];
    for (const { ms, tone } of samples) {
      expect(durationTone(ms)).toBe(tone);
    }
  });

  test("non-finite collapses to fast", () => {
    expect(durationTone(Number.NaN)).toBe("fast");
    expect(durationTone(-12)).toBe("fast");
  });
});

describe("durationClassName", () => {
  test("maps tones to distinct color families", () => {
    expect(durationClassName(5)).toContain("emerald");
    expect(durationClassName(75)).toContain("lime");
    expect(durationClassName(150)).toContain("yellow");
    expect(durationClassName(300)).toContain("amber");
    expect(durationClassName(700)).toContain("orange");
    expect(durationClassName(1_200)).toContain("destructive");
    expect(durationClassName(8_000)).toContain("rose");
  });
});

describe("DURATION_THRESHOLD_OPTIONS", () => {
  test("includes expanded presets from 10ms through 5s", () => {
    expect(DURATION_THRESHOLD_OPTIONS).toEqual([null, 10, 25, 50, 100, 250, 500, 1_000, 5_000]);
  });
});

describe("durationToneDotClass", () => {
  test("maps tones to solid fills", () => {
    expect(durationToneDotClass("fast")).toContain("bg-emerald");
    expect(durationToneDotClass("elevated")).toContain("bg-yellow");
    expect(durationToneDotClass("critical")).toContain("bg-rose");
  });
});

describe("durationThresholdDotClass", () => {
  test("neutral for any; ladder for thresholds", () => {
    expect(durationThresholdDotClass(null)).toContain("muted-foreground");
    expect(durationThresholdDotClass(10)).toContain("bg-emerald");
    expect(durationThresholdDotClass(5_000)).toContain("bg-rose");
  });
});
