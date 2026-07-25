/**
 * Folded-time waterfall tests (console §9.3).
 */

import { describe, expect, test } from "bun:test";
import { TRACES_FIXTURE } from "./fixture.ts";
import {
  COLLAPSED_FOLD_DISPLAY_MS,
  foldTimeline,
  formatFoldLabel,
  intervalsFromSpans,
} from "./fold.ts";

describe("foldTimeline", () => {
  test("collapses multi-day idle into one labelled fold", () => {
    const chain = TRACES_FIXTURE.filter(
      (s) => s.id === "run-create-ok" || s.id === "run-fulfill",
    );
    const folded = foldTimeline(intervalsFromSpans(chain));
    const folds = folded.segments.filter((s) => s.kind === "fold");
    expect(folds.length).toBe(1);
    const fold = folds[0];
    expect(fold?.kind).toBe("fold");
    if (fold?.kind !== "fold") return;
    expect(fold.durationMs).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(fold.label).toContain("d idle");
    expect(fold.displayMs).toBe(COLLAPSED_FOLD_DISPLAY_MS);
    expect(fold.expanded).toBe(false);
  });

  test("expanded fold restores proportional display weight", () => {
    const chain = TRACES_FIXTURE.filter(
      (s) => s.id === "run-create-ok" || s.id === "run-fulfill",
    );
    const intervals = intervalsFromSpans(chain);
    const draft = foldTimeline(intervals);
    const foldId = draft.segments.find((s) => s.kind === "fold")?.id;
    expect(foldId).toBeDefined();
    const folded = foldTimeline(intervals, {
      expandedFolds: new Set([foldId!]),
    });
    const fold = folded.segments.find((s) => s.kind === "fold");
    expect(fold?.kind).toBe("fold");
    if (fold?.kind !== "fold") return;
    expect(fold.expanded).toBe(true);
    expect(fold.displayMs).toBe(fold.durationMs);
  });

  test("work stays proportional — display sum excludes collapsed dead time", () => {
    const chain = TRACES_FIXTURE.filter(
      (s) => s.id === "run-create-ok" || s.id === "run-fulfill",
    );
    const folded = foldTimeline(intervalsFromSpans(chain));
    const workDisplay = folded.segments
      .filter((s) => s.kind === "work")
      .reduce((s, seg) => s + seg.displayMs, 0);
    expect(folded.displayDurationMs).toBe(
      workDisplay + COLLAPSED_FOLD_DISPLAY_MS,
    );
    expect(folded.wallDurationMs).toBeGreaterThan(folded.displayDurationMs);
  });

  test("formatFoldLabel uses human units", () => {
    expect(formatFoldLabel(20)).toBe("20ms idle");
    expect(formatFoldLabel(7 * 24 * 60 * 60 * 1000)).toBe("7d idle");
  });
});
