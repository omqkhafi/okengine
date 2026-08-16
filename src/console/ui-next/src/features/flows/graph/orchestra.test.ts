/**
 * Overview orchestra — repertoire pick + minted notes.
 */

import { describe, expect, test } from "bun:test";
import type { RunRow } from "@/client.ts";
import {
  isOrchestraRunId,
  materializeOrchestraRun,
  nextOrchestraDelayMs,
  ORCHESTRA_ID_PREFIX,
  pickOrchestraTemplate,
  shouldRunOrchestra,
} from "./orchestra.ts";

function sampleRun(partial: Partial<RunRow> = {}): RunRow {
  return {
    id: "run-1",
    parentId: "parent-1",
    flow: "issues.list",
    unit: "issues",
    trigger: "http",
    plane: "user",
    tenant: null,
    principal: null,
    gates: ["member"],
    cache: "none",
    replica: null,
    replicaLagMs: null,
    cost: null,
    inputTokens: null,
    outputTokens: null,
    promptVersion: null,
    buildVersion: null,
    startedAt: 1_000,
    endedAt: 1_014,
    durationMs: 14,
    error: null,
    errorMessage: null,
    sampled: "sample",
    effects: [
      {
        kind: "read",
        resource: "sql:issues",
        timestamp: 1_002,
        duration: 8,
        reversibility: "none",
      },
    ],
    logs: [{ level: "debug", message: "listed", at: 1_003 }],
    dimensions: { flow: "issues.list" },
    input: null,
    output: null,
    ...partial,
  };
}

describe("pickOrchestraTemplate", () => {
  test("skips minted notes and empty flow ids", () => {
    const host = sampleRun();
    const minted = sampleRun({ id: `${ORCHESTRA_ID_PREFIX}1-issues-list`, flow: "issues.create" });
    expect(pickOrchestraTemplate([minted, host], () => 0)?.id).toBe("run-1");
    expect(pickOrchestraTemplate([minted], () => 0)).toBeNull();
    expect(pickOrchestraTemplate([sampleRun({ flow: "" })], () => 0)).toBeNull();
  });
});

describe("materializeOrchestraRun", () => {
  test("stamps a new id at now and shifts effect times", () => {
    const note = materializeOrchestraRun(sampleRun(), 50_000, 3);
    expect(isOrchestraRunId(note.id)).toBe(true);
    expect(note.id).toContain("issues-list");
    expect(note.parentId).toBeNull();
    expect(note.startedAt).toBe(50_000);
    expect(note.endedAt).toBe(50_014);
    expect(note.effects[0]?.timestamp).toBe(50_002);
    expect(note.logs[0]?.at).toBe(50_003);
    expect(note.flow).toBe("issues.list");
  });
});

describe("shouldRunOrchestra", () => {
  test("mints notes only in the seeded Console", () => {
    expect(shouldRunOrchestra(true, true)).toBe(true);
    expect(shouldRunOrchestra(false, true)).toBe(false);
    expect(shouldRunOrchestra(true, false)).toBe(false);
    expect(shouldRunOrchestra(false, false)).toBe(false);
  });
});

describe("nextOrchestraDelayMs", () => {
  test("stays in the readable window", () => {
    expect(nextOrchestraDelayMs(() => 0)).toBe(1800);
    expect(nextOrchestraDelayMs(() => 0.999)).toBeGreaterThanOrEqual(1800);
    expect(nextOrchestraDelayMs(() => 0.999)).toBeLessThan(3600);
  });
});
