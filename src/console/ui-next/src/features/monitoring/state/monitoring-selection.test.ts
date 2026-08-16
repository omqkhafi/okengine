import { describe, expect, test } from "bun:test";
import { validateMonitoringSearch } from "./monitoring-selection.ts";

describe("validateMonitoringSearch", () => {
  test("keeps run, non-default window, error, and q", () => {
    expect(
      validateMonitoringSearch({ run: "r1", window: "7d", error: "FlightFull", q: "book" }),
    ).toEqual({
      run: "r1",
      window: "7d",
      error: "FlightFull",
      q: "book",
    });
  });

  test("drops empty values and the default window", () => {
    expect(validateMonitoringSearch({ run: "", window: "1h", error: "", q: "" })).toEqual({});
    expect(validateMonitoringSearch({ window: "nope" })).toEqual({});
  });
});
