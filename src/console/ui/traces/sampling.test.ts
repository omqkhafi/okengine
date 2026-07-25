/**
 * Sampling honesty tests (console §9.3).
 */

import { describe, expect, test } from "bun:test";
import {
  boostFlowFully,
  DEFAULT_SAMPLING_LABEL,
  FULL_TRACE_BOOST_MS,
  pruneBoosts,
  samplingLabel,
} from "./sampling.ts";

describe("sampling", () => {
  test("default label states 10% + all errors", () => {
    expect(samplingLabel([])).toBe(DEFAULT_SAMPLING_LABEL);
  });

  test("boost adds a 10-minute full-trace escape hatch", () => {
    const now = 1_000_000;
    const boosts = boostFlowFully([], "bookings.create", now);
    expect(boosts[0]?.until).toBe(now + FULL_TRACE_BOOST_MS);
    expect(samplingLabel(boosts, now)).toContain("bookings.create");
    expect(pruneBoosts(boosts, now + FULL_TRACE_BOOST_MS + 1)).toEqual([]);
  });
});
