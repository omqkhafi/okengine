/**
 * Unit tests for live replica-lag projection.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { latestReplicaLagFromRuns } from "./replica-lag.ts";

function run(partial: Partial<RunRow> & Pick<RunRow, "id" | "startedAt">): RunRow {
  return {
    parentId: null,
    flow: "bookings.create",
    unit: null,
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: "replica",
    replicaLagMs: null,
    cost: null,
    inputTokens: null,
    outputTokens: null,
    promptVersion: null,
    buildVersion: null,
    endedAt: partial.startedAt + 1,
    durationMs: 1,
    error: null,
    errorMessage: null,
    sampled: "sample",
    effects: [],
    logs: [],
    dimensions: {},
    input: null,
    output: null,
    ...partial,
  };
}

const refs = new Set(["sql:bookings"]);

describe("latestReplicaLagFromRuns", () => {
  test("empty buffer → null", () => {
    expect(latestReplicaLagFromRuns([], refs)).toBeNull();
  });

  test("ignores runs that do not touch the resource", () => {
    const rows = [
      run({
        id: "a",
        startedAt: 10,
        replicaLagMs: 400,
        effects: [
          {
            kind: "read",
            resource: "sql:other",
            timestamp: 10,
            duration: 1,
            reversibility: "none",
          },
        ],
      }),
    ];
    expect(latestReplicaLagFromRuns(rows, refs)).toBeNull();
  });

  test("uses the most recent touching run, not the max lag", () => {
    const rows = [
      run({
        id: "old",
        startedAt: 10,
        replicaLagMs: 180,
        effects: [
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: 10,
            duration: 1,
            reversibility: "none",
          },
        ],
      }),
      run({
        id: "new",
        startedAt: 50,
        replicaLagMs: 12,
        effects: [
          {
            kind: "write",
            resource: "sql:bookings",
            timestamp: 50,
            duration: 1,
            reversibility: "none",
          },
        ],
      }),
    ];
    expect(latestReplicaLagFromRuns(rows, refs)).toBe(12);
  });
});
