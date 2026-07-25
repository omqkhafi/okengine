/**
 * Outlier explanation via Prompt 14's explainOutliers (console §9.11).
 */

import { describe, expect, test } from "bun:test";
import { explainDurationOutliers } from "./explain.ts";
import { runsOutlierFixture } from "./fixture.ts";

describe("explainDurationOutliers", () => {
  test("surfaces cache=miss as the top separator for the slow region", () => {
    const runs = runsOutlierFixture();
    const findings = explainDurationOutliers(runs, {
      minMs: 1000,
      maxMs: 10_000,
    });
    expect(findings.length).toBeGreaterThan(0);
    const top = findings[0]!;
    expect(top.dimension).toBe("cache");
    expect(top.value).toBe("miss");
    expect(top.explanation).toMatch(/cache=miss/);
    expect(top.lift).toBeGreaterThan(0.5);
  });
});
