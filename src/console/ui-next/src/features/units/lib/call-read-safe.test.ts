import { describe, expect, test } from "bun:test";
import { isReadSafeCall, shouldRefetchCallOnPiiReveal } from "./call-read-safe.ts";
import type { UnitFlowRow } from "./unit-tree.ts";

function row(effects: UnitFlowRow["flow"]["effects"]): UnitFlowRow {
  return {
    id: "issues.list",
    unit: "issues",
    action: "list",
    method: "GET",
    path: "/issues",
    signal: null,
    delivery: null,
    flow: { effects },
  };
}

describe("isReadSafeCall", () => {
  test("allows re-invoke when the flow only reads", () => {
    expect(isReadSafeCall(row({ reads: ["sql:issues"] }))).toBe(true);
    expect(isReadSafeCall(row(undefined))).toBe(true);
  });

  test("refuses re-invoke when the flow writes or emits", () => {
    expect(isReadSafeCall(row({ writes: ["sql:issues"] }))).toBe(false);
    expect(isReadSafeCall(row({ emits: ["issue-updated"] }))).toBe(false);
    expect(isReadSafeCall(row({ sends: ["issue-mail"] }))).toBe(false);
  });
});

describe("shouldRefetchCallOnPiiReveal", () => {
  test("refetches only when turning Include PII on for a read-safe flow", () => {
    const list = row({ reads: ["sql:views"] });
    expect(shouldRefetchCallOnPiiReveal(list, false)).toBe(true);
    expect(shouldRefetchCallOnPiiReveal(list, true)).toBe(false);
    expect(shouldRefetchCallOnPiiReveal(row({ writes: ["sql:views"] }), false)).toBe(false);
  });
});
