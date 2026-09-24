/**
 * Unit tests for dense-trace lane grouping.
 */

import { describe, expect, test } from "bun:test";
import type { RunEffect } from "@/client.ts";
import { traceIsDense, traceLanes, TRACE_DENSE_MIN } from "./trace-lanes.ts";
import { waterfallBars } from "./waterfall-bars.ts";

function effect(
  partial: Pick<RunEffect, "kind" | "resource" | "timestamp" | "duration">,
): RunEffect {
  return { reversibility: "none", ...partial };
}

describe("traceIsDense", () => {
  test("stays flat at the threshold and groups above it", () => {
    expect(traceIsDense(TRACE_DENSE_MIN)).toBe(false);
    expect(traceIsDense(TRACE_DENSE_MIN + 1)).toBe(true);
  });
});

describe("traceLanes", () => {
  test("collapses repeated kind+resource and keeps first-seen order", () => {
    const startedAt = 1_000;
    const bars = waterfallBars(
      [
        effect({ kind: "read", resource: "sql:tasks", timestamp: 1_000, duration: 18 }),
        effect({ kind: "read", resource: "sql:task_assignees", timestamp: 1_020, duration: 3 }),
        effect({ kind: "send", resource: "task-overdue", timestamp: 1_024, duration: 4 }),
        effect({ kind: "write", resource: "sql:inbox", timestamp: 1_028, duration: 3 }),
        effect({ kind: "send", resource: "task-overdue", timestamp: 1_032, duration: 1 }),
        effect({ kind: "write", resource: "sql:inbox", timestamp: 1_034, duration: 2 }),
      ],
      startedAt,
      40,
    );
    const lanes = traceLanes(bars);
    expect(lanes.map((lane) => lane.resource)).toEqual([
      "sql:tasks",
      "sql:task_assignees",
      "task-overdue",
      "sql:inbox",
    ]);
    expect(lanes[2]?.bars.map((bar) => bar.index)).toEqual([2, 4]);
    expect(lanes[3]?.totalDurationMs).toBe(5);
    expect(lanes[0]?.bars).toHaveLength(1);
  });

  test("does not merge different kinds on the same resource", () => {
    const bars = waterfallBars(
      [
        effect({ kind: "read", resource: "sql:inbox", timestamp: 0, duration: 1 }),
        effect({ kind: "write", resource: "sql:inbox", timestamp: 2, duration: 1 }),
      ],
      0,
      10,
    );
    expect(traceLanes(bars)).toHaveLength(2);
  });
});
