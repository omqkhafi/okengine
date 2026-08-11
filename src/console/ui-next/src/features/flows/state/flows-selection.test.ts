/**
 * Flows URL search validation — run / flow / follow.
 */

import { describe, expect, test } from "bun:test";
import { validateFlowsSearch } from "./flows-selection.ts";

describe("validateFlowsSearch", () => {
  test("accepts non-empty flow and run ids", () => {
    expect(validateFlowsSearch({ flow: "bookings.create", run: "r1" })).toEqual({
      flow: "bookings.create",
      run: "r1",
    });
  });

  test("drops empty flow / run strings", () => {
    expect(validateFlowsSearch({ flow: "", run: "" })).toEqual({});
  });

  test("parses follow=false", () => {
    expect(validateFlowsSearch({ follow: false })).toEqual({ follow: false });
    expect(validateFlowsSearch({ follow: "false" })).toEqual({ follow: false });
  });
});
