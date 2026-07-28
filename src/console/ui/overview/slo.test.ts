/**
 * SLO burn math — Manifest thresholds only (console §9.16).
 */

import { describe, expect, test } from "bun:test";
import { computeSloBurns, declaredSlos, hasDeclaredSlos, parseAvailability } from "./slo.ts";
import {
  OVERVIEW_BURN_RUNS,
  OVERVIEW_DAY_ONE_INPUTS,
  OVERVIEW_MANIFEST,
  OVERVIEW_NOW,
} from "./fixture.ts";

describe("parseAvailability", () => {
  test("reads Manifest strings into tolerable error rate", () => {
    expect(parseAvailability("99.9%")).toBeCloseTo(0.001, 10);
    expect(parseAvailability("99.5")).toBeCloseTo(0.005, 10);
    expect(parseAvailability("100%")).toBe(0);
    expect(parseAvailability("not-a-number")).toBeNull();
  });
});

describe("declaredSlos", () => {
  test("reads flow- and journey-level SLOs from the Manifest", () => {
    const slos = declaredSlos(OVERVIEW_MANIFEST);
    expect(slos.some((s) => s.id === "flow:bookings.create")).toBe(true);
    expect(slos.some((s) => s.id === "journey:book-a-flight")).toBe(true);
    expect(slos.find((s) => s.id === "flow:bookings.create")?.tolerableErrorRate).toBeCloseTo(
      0.001,
      10,
    );
  });

  test("day-one Manifest has no declared SLOs", () => {
    expect(hasDeclaredSlos(OVERVIEW_DAY_ONE_INPUTS.manifest)).toBe(false);
  });
});

describe("computeSloBurns", () => {
  test("burn rate is current error rate ÷ tolerable rate from Runs", () => {
    const burns = computeSloBurns({
      manifest: OVERVIEW_MANIFEST,
      runs: OVERVIEW_BURN_RUNS,
      now: OVERVIEW_NOW,
    });
    const booking = burns.find((b) => b.name === "bookings.create");
    expect(booking).toBeDefined();
    // 20 errors / 100 runs = 0.2; tolerable 0.001 → burn 200×
    expect(booking!.currentErrorRate).toBeCloseTo(0.2, 5);
    expect(booking!.burnRate).toBeCloseTo(200, 0);
    expect(booking!.timeToExhaustionMs).not.toBeNull();
    expect(booking!.ceremonial).toBe(false);
  });

  test("marks CEREMONIAL when burn history is empty over 90 days", () => {
    const healthy = OVERVIEW_BURN_RUNS.map((r) => ({
      ...r,
      error: null,
    }));
    const burns = computeSloBurns({
      manifest: OVERVIEW_MANIFEST,
      runs: healthy,
      now: OVERVIEW_NOW,
    });
    const booking = burns.find((b) => b.name === "bookings.create");
    expect(booking!.burnRate).toBe(0);
    expect(booking!.ceremonial).toBe(true);
  });
});
