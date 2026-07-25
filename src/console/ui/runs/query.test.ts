/**
 * Dimension query language tests (console §9.11).
 */

import { describe, expect, test } from "bun:test";
import { RUNS_CHAIN_FIXTURE } from "./fixture.ts";
import {
  filterRuns,
  formatClause,
  parseDimensionQuery,
  parseDurationMs,
  serializeDimensionQuery,
  upsertClause,
} from "./query.ts";

describe("dimension query", () => {
  test("parses flow = X AND cache = miss AND duration > 1s", () => {
    const q = parseDimensionQuery(
      "flow = bookings.create AND cache = miss AND duration > 1s",
    );
    expect(q.clauses).toEqual([
      { dimension: "flow", op: "=", value: "bookings.create" },
      { dimension: "cache", op: "=", value: "miss" },
      { dimension: "duration", op: ">", value: 1000 },
    ]);
    expect(serializeDimensionQuery(q)).toBe(
      "flow = bookings.create AND cache = miss AND duration > 1s",
    );
  });

  test("duration units ms / s / m", () => {
    expect(parseDurationMs("200ms")).toBe(200);
    expect(parseDurationMs("1s")).toBe(1000);
    expect(parseDurationMs("2m")).toBe(120_000);
    expect(parseDurationMs("50")).toBe(50);
  });

  test("filters the chain fixture by cache = miss", () => {
    const q = parseDimensionQuery("cache = miss");
    const hits = filterRuns(RUNS_CHAIN_FIXTURE, q);
    expect(hits.map((r) => r.id)).toEqual(["run-create-fail"]);
  });

  test("upsert replaces same dimension", () => {
    let q = parseDimensionQuery("cache = hit");
    q = upsertClause(q, { dimension: "cache", op: "=", value: "miss" });
    expect(serializeDimensionQuery(q)).toBe("cache = miss");
    expect(formatClause(q.clauses[0]!)).toBe("cache = miss");
  });
});
