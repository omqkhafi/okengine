/**
 * Ask-effect counts — empty when no ask effects exist.
 */

import { describe, expect, test } from "bun:test";
import { askCountInWindow } from "./ask-count.ts";
import { monitoringRun } from "./run-fixture.ts";

describe("askCountInWindow", () => {
  test("no ask effects → honest empty", () => {
    const now = 1_000;
    const runs = [monitoringRun({ id: "a", flow: "x", startedAt: now - 10 })];
    expect(askCountInWindow(runs, now, 60_000)).toEqual({ kind: "empty" });
  });

  test("counts ask effects in the window", () => {
    const now = 1_000;
    const runs = [
      monitoringRun({
        id: "a",
        flow: "x",
        startedAt: now - 10,
        effects: [
          {
            kind: "ask",
            resource: "summarize",
            timestamp: now - 10,
            duration: 12,
            reversibility: "irreversible",
          },
          {
            kind: "read",
            resource: "sql:bookings",
            timestamp: now - 10,
            duration: 1,
            reversibility: "none",
          },
        ],
      }),
    ];
    expect(askCountInWindow(runs, now, 60_000)).toEqual({
      kind: "summary",
      asks: 1,
      windowMs: 60_000,
    });
  });
});
