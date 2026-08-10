/**
 * Unit tests proving the Replay action targets the real console.traces.replay
 * request shape (not a no-op). Backend execution is covered by
 * `src/console/server/traces-replay.test.ts`.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import { copyRunIdText, replayRequestForRun, runNeedsDryRun } from "./trace-actions.ts";

function sampleRun(partial: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-42",
    parentId: null,
    flow: "bookings.create",
    unit: "bookings",
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: [],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    promptVersion: null,
    buildVersion: null,
    startedAt: 1,
    endedAt: 13,
    durationMs: 12,
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

describe("replayRequestForRun", () => {
  test("posts rootId to the real tracesReplay path shape", () => {
    expect(replayRequestForRun(sampleRun())).toEqual({
      rootId: "run-42",
      dryRun: false,
    });
  });

  test("requests dry-run when the ledger has irreversible effects", () => {
    const run = sampleRun({
      effects: [
        {
          kind: "send",
          resource: "mail",
          timestamp: 1,
          duration: 1,
          reversibility: "irreversible",
        },
      ],
    });
    expect(runNeedsDryRun(run)).toBe(true);
    expect(replayRequestForRun(run)).toEqual({
      rootId: "run-42",
      dryRun: true,
    });
  });
});

describe("copyRunIdText", () => {
  test("returns the real run id for the clipboard", () => {
    expect(copyRunIdText(sampleRun({ id: "pw-run-bookings-create" }))).toBe(
      "pw-run-bookings-create",
    );
    expect(copyRunIdText(sampleRun())).toBe("run-42");
  });
});
