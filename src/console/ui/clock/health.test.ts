/**
 * Health formatting.
 */

import { describe, expect, test } from "bun:test";
import { CLOCK_LIST_FIXTURE } from "./fixture.ts";
import { filterCrons, formatHealth } from "./health.ts";

describe("formatHealth", () => {
  test("four numbers for overdue cron", () => {
    const expire = CLOCK_LIST_FIXTURE.crons[0]!;
    const h = formatHealth(expire.health);
    expect(h.overdue).toBe("overdue");
    expect(h.missedWithPolicy).toContain("catch-up one");
    expect(h.lease).toContain("inst-a");
    expect(h.drift).toContain("drift");
  });
});

describe("filterCrons", () => {
  test("matches name and schedule", () => {
    expect(filterCrons(CLOCK_LIST_FIXTURE.crons, "nightly")).toHaveLength(1);
    expect(filterCrons(CLOCK_LIST_FIXTURE.crons, "10m")).toHaveLength(1);
  });
});
