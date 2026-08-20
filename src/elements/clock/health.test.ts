/**
 * Cron health + next-occurrence helpers.
 */

import { describe, expect, test } from "bun:test";
import { cronHealth } from "./health.ts";
import { nextOccurrences } from "./schedule.ts";
import type { CronRow } from "./reconcile.ts";

function row(partial: Partial<CronRow> & { name: string }): CronRow {
  return {
    timezone: "UTC",
    overridable: false,
    status: "active",
    ...partial,
  };
}

describe("cronHealth", () => {
  test("every — overdue with missed runs and catchUp one", () => {
    const now = 10_000;
    const h = cronHealth(
      row({
        name: "tick",
        effectiveEvery: "1s",
        declaredEvery: "1s",
        lastRunAt: 0,
        nextRunAt: 1_000,
      }),
      now,
    );
    expect(h.overdue).toBe(true);
    expect(h.missedRuns).toBe(10);
    expect(h.catchUp).toBe("one");
  });

  test("not overdue when nextRunAt is in the future", () => {
    const now = 1_000;
    const h = cronHealth(
      row({
        name: "ok",
        effectiveEvery: "1h",
        lastRunAt: 0,
        nextRunAt: 3_600_000,
      }),
      now,
    );
    expect(h.overdue).toBe(false);
    expect(h.missedRuns).toBe(0);
  });

  test("projects lease holder fields", () => {
    const h = cronHealth(
      row({
        name: "leased",
        effectiveEvery: "1h",
        leaderInstanceId: "inst-a",
        leaderLeaseUntil: 99_000,
        lastRunAt: 0,
        nextRunAt: 3_600_000,
      }),
      1_000,
    );
    expect(h.leaderInstanceId).toBe("inst-a");
    expect(h.leaderLeaseUntil).toBe(99_000);
  });
});

describe("nextOccurrences", () => {
  test("every — next 24h of fires", () => {
    const from = 0;
    const until = 10_000;
    const fires = nextOccurrences(
      row({
        name: "tick",
        effectiveEvery: "2s",
        lastRunAt: 0,
      }),
      from,
      until,
    );
    expect(fires[0]).toBe(2_000);
    expect(fires.length).toBe(4);
    expect(fires[fires.length - 1]).toBe(8_000);
  });

  test("simple daily cron in UTC", () => {
    // 2024-01-01 00:00 UTC
    const from = Date.UTC(2024, 0, 1, 0, 0, 0);
    const until = from + 48 * 3_600_000;
    const fires = nextOccurrences(
      row({
        name: "nightly",
        effectiveCron: "0 2 * * *",
        timezone: "UTC",
      }),
      from,
      until,
    );
    expect(fires.length).toBeGreaterThanOrEqual(1);
    expect(fires.every((t) => t >= from && t < until)).toBe(true);
  });

  test("*/15 and @hourly via Bun.cron.parse", () => {
    const from = Date.UTC(2024, 0, 1, 0, 0, 0);
    const until = from + 60 * 60_000;
    const quarters = nextOccurrences(
      row({
        name: "quarters",
        effectiveCron: "*/15 * * * *",
        timezone: "UTC",
      }),
      from,
      until,
    );
    expect(quarters).toEqual([from, from + 15 * 60_000, from + 30 * 60_000, from + 45 * 60_000]);

    const hours = nextOccurrences(
      row({
        name: "hourly",
        effectiveCron: "@hourly",
        timezone: "UTC",
      }),
      from,
      from + 3 * 3_600_000,
    );
    expect(hours).toEqual([from, from + 3_600_000, from + 2 * 3_600_000]);
  });

  test("cron timezone is the declared IANA zone", () => {
    const from = Date.UTC(2024, 0, 1, 0, 0, 0);
    const until = from + 36 * 3_600_000;
    const fires = nextOccurrences(
      row({
        name: "ny",
        effectiveCron: "0 9 * * *",
        timezone: "America/New_York",
      }),
      from,
      until,
    );
    expect(fires).toHaveLength(1);
    // 09:00 America/New_York on 2024-01-01 is 14:00 UTC (EST).
    expect(fires[0]).toBe(Date.UTC(2024, 0, 1, 14, 0, 0));
  });
});
