/**
 * Effect-filter tests (console §9.3).
 */

import { describe, expect, test } from "bun:test";
import {
  matchesEffectFilter,
  parseEffectFilter,
  serializeEffectFilter,
  traceMatchesEffectFilter,
} from "./filter.ts";
import { TRACES_FIXTURE } from "./fixture.ts";

describe("effect filter", () => {
  test("wrote:sql:bookings matches create spans", () => {
    const filter = parseEffectFilter("wrote:sql:bookings");
    expect(filter).toEqual({ kind: "wrote", resource: "sql:bookings" });
    const create = TRACES_FIXTURE.find((s) => s.id === "run-create-ok")!;
    expect(matchesEffectFilter(create, filter)).toBe(true);
    const ask = TRACES_FIXTURE.find((s) => s.id === "run-ask")!;
    expect(matchesEffectFilter(ask, filter)).toBe(false);
  });

  test("asked / sent / secret / cost queries", () => {
    expect(
      matchesEffectFilter(
        TRACES_FIXTURE.find((s) => s.id === "run-ask")!,
        { kind: "asked" },
      ),
    ).toBe(true);
    expect(
      matchesEffectFilter(
        TRACES_FIXTURE.find((s) => s.id === "run-fulfill")!,
        { kind: "sent", resource: "booking-confirmed" },
      ),
    ).toBe(true);
    expect(
      matchesEffectFilter(
        TRACES_FIXTURE.find((s) => s.id === "run-ask")!,
        { kind: "secret", resource: "OPENAI_KEY" },
      ),
    ).toBe(true);
    expect(
      matchesEffectFilter(
        TRACES_FIXTURE.find((s) => s.id === "run-ask")!,
        { kind: "cost", min: 0.05 },
      ),
    ).toBe(true);
    expect(
      matchesEffectFilter(
        TRACES_FIXTURE.find((s) => s.id === "run-create-ok")!,
        { kind: "cost", min: 0.05 },
      ),
    ).toBe(false);
  });

  test("round-trips through URL serialisation", () => {
    const filters = [
      parseEffectFilter("wrote:sql:bookings"),
      parseEffectFilter("asked"),
      parseEffectFilter("sent:booking-confirmed"),
      parseEffectFilter("secret"),
      parseEffectFilter("cost:0.05"),
    ];
    for (const f of filters) {
      expect(parseEffectFilter(serializeEffectFilter(f))).toEqual(f);
    }
  });

  test("trace-level match when any connected span matches", () => {
    const chain = TRACES_FIXTURE.filter((s) => s.id === "run-create-ok" || s.id === "run-fulfill");
    expect(traceMatchesEffectFilter(chain, { kind: "sent" })).toBe(true);
  });
});
