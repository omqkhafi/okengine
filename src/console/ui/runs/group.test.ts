/**
 * Group-by aggregate tests (console §9.11).
 */

import { describe, expect, test } from "bun:test";
import { RUNS_CHAIN_FIXTURE } from "./fixture.ts";
import { groupByDimension } from "./group.ts";

describe("groupByDimension", () => {
  test("groups by cache with count and duration aggregates", () => {
    const rows = groupByDimension(RUNS_CHAIN_FIXTURE, "cache");
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(byKey.hit?.count).toBe(1);
    expect(byKey.miss?.count).toBe(1);
    expect(byKey.none?.count).toBe(1);
    expect(byKey.hit?.avgDurationMs).toBe(45);
  });

  test("groups by flow", () => {
    const rows = groupByDimension(RUNS_CHAIN_FIXTURE, "flow");
    const create = rows.find((r) => r.key === "bookings.create");
    expect(create?.count).toBe(2);
  });
});
