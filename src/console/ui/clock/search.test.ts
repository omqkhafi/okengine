/**
 * Clock URL search.
 */

import { describe, expect, test } from "bun:test";
import {
  closeClockDetail,
  openCron,
  openWake,
  parseClockSearch,
  serializeClockSearch,
} from "./search.ts";

describe("clock search", () => {
  test("round-trips open cron + action", () => {
    const s = openCron({}, "nightly");
    expect(s.cron).toBe("nightly");
    const withAction = { ...s, action: "run" as const };
    expect(serializeClockSearch(withAction)).toEqual({
      cron: "nightly",
      action: "run",
    });
    expect(parseClockSearch({ cron: "nightly", action: "run" })).toEqual(
      withAction,
    );
  });

  test("openWake clears cron", () => {
    const s = openWake({ cron: "x" }, "run_1");
    expect(s.wake).toBe("run_1");
    expect(s.cron).toBeUndefined();
  });

  test("closeClockDetail", () => {
    expect(closeClockDetail({ cron: "a", wake: "b", action: "edit", q: "z" })).toEqual({
      q: "z",
    });
  });
});
