/**
 * Top errors — keep latestRunId; never invent a zero group.
 */

import { describe, expect, test } from "bun:test";
import { monitoringRun } from "./run-fixture.ts";
import { bandErrorGroups, errorGroupKey, filterErrorGroups, topErrors } from "./top-errors.ts";

describe("topErrors", () => {
  test("no failures → honest empty", () => {
    const now = 1_000_000;
    const runs = [monitoringRun({ id: "ok", flow: "a", startedAt: now - 10 })];
    expect(topErrors(runs, now, 60_000)).toEqual({ kind: "empty" });
  });

  test("groups by code + message + flow and keeps newest run id", () => {
    const now = 1_000_000;
    const runs = [
      monitoringRun({
        id: "old",
        flow: "bookings.create",
        startedAt: now - 4_000,
        error: "FlightFull",
        errorMessage: "full",
      }),
      monitoringRun({
        id: "new",
        flow: "bookings.create",
        startedAt: now - 1_000,
        error: "FlightFull",
        errorMessage: "full",
      }),
      monitoringRun({
        id: "other",
        flow: "issues.list",
        startedAt: now - 2_000,
        error: "Denied",
      }),
    ];
    const result = topErrors(runs, now, 60_000);
    expect(result.kind).toBe("groups");
    if (result.kind !== "groups") return;
    expect(result.groups).toEqual([
      {
        key: errorGroupKey("FlightFull", "full", "bookings.create"),
        error: "FlightFull",
        errorMessage: "full",
        flow: "bookings.create",
        count: 2,
        latestStartedAt: now - 1_000,
        latestRunId: "new",
      },
      {
        key: errorGroupKey("Denied", null, "issues.list"),
        error: "Denied",
        errorMessage: null,
        flow: "issues.list",
        count: 1,
        latestStartedAt: now - 2_000,
        latestRunId: "other",
      },
    ]);
  });

  test("filter and band by error code", () => {
    const groups = [
      {
        key: "a",
        error: "FlightFull",
        errorMessage: "full",
        flow: "bookings.create",
        count: 2,
        latestStartedAt: 2,
        latestRunId: "n",
      },
      {
        key: "b",
        error: "Denied",
        errorMessage: null,
        flow: "issues.list",
        count: 1,
        latestStartedAt: 1,
        latestRunId: "o",
      },
    ];
    expect(filterErrorGroups(groups, "book").map((g) => g.key)).toEqual(["a"]);
    expect(bandErrorGroups(groups).map((b) => b.error)).toEqual(["FlightFull", "Denied"]);
  });
});
