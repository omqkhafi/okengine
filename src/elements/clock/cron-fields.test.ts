/**
 * Structured cron fields + clock convenience helpers.
 */

import { describe, expect, test, beforeEach } from "bun:test";

import {
  buildCronExpression,
  parseAtTime,
  serializeCronField,
} from "./cron-fields.ts";
import {
  applyClockTimezoneDefaults,
  clock,
  listClocks,
  resetClocks,
} from "./declare.ts";

describe("buildCronExpression", () => {
  test("at sugar sets minute and hour", () => {
    expect(buildCronExpression({ at: "06:00" })).toBe("0 6 * * *");
    expect(buildCronExpression({ at: "6:00" })).toBe("0 6 * * *");
    expect(buildCronExpression({ at: "08:30" })).toBe("30 8 * * *");
  });

  test("lists, steps, and weekday names", () => {
    expect(
      buildCronExpression({
        minute: "*/15",
        hour: [9, 12, 17],
        dayOfWeek: "1-5",
      }),
    ).toBe("*/15 9,12,17 * * 1-5");

    expect(
      buildCronExpression({
        at: "08:00",
        dayOfWeek: ["mon", "wed", "fri"],
      }),
    ).toBe("0 8 * * 1,3,5");
  });

  test("at does not override explicit minute/hour", () => {
    expect(buildCronExpression({ at: "06:00", minute: 15 })).toBe("15 6 * * *");
    expect(buildCronExpression({ at: "06:00", hour: 9 })).toBe("0 9 * * *");
  });

  test("rejects empty bag and bad at", () => {
    expect(() => buildCronExpression({})).toThrow(/require at least one/);
    expect(() => parseAtTime("nope")).toThrow(/HH:MM/);
    expect(() => parseAtTime("25:00")).toThrow(/hour/);
    expect(() => parseAtTime("12:99")).toThrow(/minute/);
  });

  test("serializeCronField maps day names", () => {
    expect(serializeCronField("tue", "dayOfWeek")).toBe("2");
    expect(serializeCronField(["sun", "sat"], "dayOfWeek")).toBe("0,6");
  });
});

describe("clock helpers", () => {
  beforeEach(() => {
    resetClocks();
  });

  test("daily / hourly / weekly / monthly / every / cron string", () => {
    expect(clock.daily("reports.daily", { at: "06:00", timezone: "Asia/Riyadh" })).toMatchObject({
      name: "reports.daily",
      cron: "0 6 * * *",
      timezone: "Asia/Riyadh",
    });

    expect(clock.hourly("metrics.rollup", { minute: 15 })).toMatchObject({
      cron: "15 * * * *",
    });

    expect(clock.weekly("digest", { on: ["mon", "fri"], at: "09:00" })).toMatchObject({
      cron: "0 9 * * 1,5",
    });

    expect(clock.monthly("billing", { on: [1, 15], at: "00:00" })).toMatchObject({
      cron: "0 0 1,15 * *",
    });

    expect(clock.every("health.ping", "30s")).toMatchObject({
      every: "30s",
      cron: undefined,
    });

    expect(clock.cron("legacy", "@hourly")).toMatchObject({
      cron: "@hourly",
    });
  });

  test("clock.cron structured fields", () => {
    const decl = clock.cron("ops.sweep", {
      minute: "*/15",
      hour: [9, 12, 17],
      dayOfWeek: "1-5",
      timezone: "UTC",
      overridable: true,
      description: "weekday sweeps",
    });
    expect(decl).toMatchObject({
      name: "ops.sweep",
      cron: "*/15 9,12,17 * * 1-5",
      timezone: "UTC",
      overridable: true,
      description: "weekday sweeps",
    });
  });

  test("invalid cron fails at declare", () => {
    expect(() => clock.cron("bad", "not a cron")).toThrow(/invalid cron/);
    expect(() => clock("bad", { cron: "99 99 * * *" })).toThrow(/invalid cron/);
  });

  test("helpers register into listClocks", () => {
    clock.daily("a", { at: "01:00" });
    clock.every("b", "1h");
    expect(listClocks().map((c) => c.name)).toEqual(["a", "b"]);
  });

  test("omitted timezone is marked defaulted", () => {
    const d = clock.daily("x", { at: "06:00" });
    expect(d.timezone).toBe("UTC");
    expect(d.timezoneDefaulted).toBe(true);
    const explicit = clock.daily("y", { at: "06:00", timezone: "UTC" });
    expect(explicit.timezoneDefaulted).toBeUndefined();
  });
});

describe("applyClockTimezoneDefaults", () => {
  beforeEach(() => {
    resetClocks();
  });

  test("rewrites defaulted clocks; keeps explicit", () => {
    const a = clock.daily("a", { at: "06:00" });
    const b = clock.daily("b", { at: "07:00", timezone: "Europe/London" });
    const out = applyClockTimezoneDefaults([a, b], "Asia/Riyadh");
    expect(out[0]).toMatchObject({ name: "a", timezone: "Asia/Riyadh" });
    expect(out[0]?.timezoneDefaulted).toBeUndefined();
    expect(out[1]).toMatchObject({ name: "b", timezone: "Europe/London" });
  });

  test("no-op when default timezone omitted", () => {
    const a = clock.daily("a", { at: "06:00" });
    const out = applyClockTimezoneDefaults([a], undefined);
    expect(out[0]?.timezone).toBe("UTC");
    expect(out[0]?.timezoneDefaulted).toBe(true);
  });
});
