/**
 * Waiting-on helpers.
 */

import { describe, expect, test } from "bun:test";
import { CLOCK_LIST_FIXTURE } from "./fixture.ts";
import { aggregateByLabel, formatWakeIn, waitingOnBanner } from "./waiting-on.ts";

describe("waiting-on", () => {
  test("aggregates by label", () => {
    const counts = aggregateByLabel(CLOCK_LIST_FIXTURE.waitingOn);
    expect(counts[0]).toEqual({ label: "trial-period", count: 2 });
    expect(counts.find((c) => c.label === "verify-window")?.count).toBe(1);
  });

  test("banner summarizes sleeping system", () => {
    const banner = waitingOnBanner(
      CLOCK_LIST_FIXTURE.waitingOn.length,
      CLOCK_LIST_FIXTURE.waitingOnCounts,
    );
    expect(banner).toContain("3 sleeping");
    expect(banner).toContain("trial-period");
  });

  test("formatWakeIn", () => {
    expect(formatWakeIn(0)).toBe("due");
    expect(formatWakeIn(45_000)).toBe("45s");
    expect(formatWakeIn(120_000)).toBe("2m");
  });
});
