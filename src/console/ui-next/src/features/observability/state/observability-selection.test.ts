import { describe, expect, test } from "bun:test";
import { validateObservabilitySearch } from "./observability-selection.ts";

describe("validateObservabilitySearch", () => {
  test("keeps run, non-default window, error, and q", () => {
    expect(
      validateObservabilitySearch({
        run: "r1",
        window: "7d",
        error: "FlightFull",
        q: "book",
        view: "query",
      }),
    ).toEqual({
      run: "r1",
      window: "7d",
      error: "FlightFull",
      q: "book",
      view: "query",
    });
  });

  test("drops empty values and the default window", () => {
    expect(validateObservabilitySearch({ run: "", window: "1h", error: "", q: "" })).toEqual({});
    expect(validateObservabilitySearch({ window: "nope" })).toEqual({});
  });
});
