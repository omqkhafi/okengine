/**
 * Trace header identity lines and previous / next neighbors.
 */

import { describe, expect, test } from "bun:test";
import { traceIdentityLines, traceNav } from "./trace-nav.ts";

describe("traceIdentityLines", () => {
  test("shows the run id", () => {
    expect(traceIdentityLines({ id: "run-a", parentId: null })).toEqual([
      { key: "run", label: "Run", value: "run-a" },
    ]);
  });

  test("adds the parent id when the trace was called", () => {
    expect(traceIdentityLines({ id: "child", parentId: "root" })).toEqual([
      { key: "run", label: "Run", value: "child" },
      { key: "parent", label: "Parent", value: "root" },
    ]);
  });
});

describe("traceNav", () => {
  const runs = [{ id: "new" }, { id: "mid" }, { id: "old" }];

  test("steps to the row above and the row below", () => {
    expect(traceNav(runs, "mid")).toEqual({
      index: 1,
      total: 3,
      previousId: "new",
      nextId: "old",
    });
  });

  test("disables the missing end", () => {
    expect(traceNav(runs, "new").previousId).toBeNull();
    expect(traceNav(runs, "old").nextId).toBeNull();
  });

  test("has no neighbors when the open trace is not in the list", () => {
    expect(traceNav(runs, "missing")).toEqual({
      index: -1,
      total: 3,
      previousId: null,
      nextId: null,
    });
  });
});
