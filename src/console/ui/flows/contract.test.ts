/**
 * Dual contract editor — local validation before send (console §9.2).
 */

import { describe, expect, test } from "bun:test";
import {
  diffAgainstSchema,
  fieldsFromSchema,
  parseJsonEditor,
  seedFromSchema,
  setAtPath,
  validateContract,
  valueToJsonText,
} from "./contract.ts";
import { FLOWS_TEST_MANIFEST } from "./fixture.ts";

const schema = FLOWS_TEST_MANIFEST.flows!["bookings.create"]!.in as Record<string, unknown>;

describe("contract editor", () => {
  test("validates locally before sending", () => {
    const bad = validateContract(schema, { flightId: "SK1" });
    expect(bad.ok).toBe(false);
    expect(bad.errors.some((e) => e.path.includes("seats") || e.message.includes("required"))).toBe(
      true,
    );

    const good = validateContract(schema, {
      flightId: "SK1",
      seats: 2,
      cabin: "economy",
    });
    expect(good.ok).toBe(true);
    expect(good.errors).toEqual([]);
  });

  test("rejects out-of-range seats without a network round trip", () => {
    const result = validateContract(schema, {
      flightId: "SK1",
      seats: 0,
    });
    expect(result.ok).toBe(false);
  });

  test("seeds a plausible example from constraints", () => {
    const seed = seedFromSchema(schema) as Record<string, unknown>;
    expect(typeof seed.flightId).toBe("string");
    expect(seed.seats).toBe(1);
    expect(seed.cabin).toBe("economy");
    expect(validateContract(schema, seed).ok).toBe(true);
  });

  test("form fields map enum / min / nested", () => {
    const fields = fieldsFromSchema(schema);
    const seats = fields.find((f) => f.name === "seats");
    const cabin = fields.find((f) => f.name === "cabin");
    expect(seats?.type).toBe("integer");
    expect(seats?.minimum).toBe(1);
    expect(cabin?.type).toBe("enum");
    expect(cabin?.enumValues).toEqual(["economy", "business"]);
  });

  test("form ⇄ JSON sync round-trips", () => {
    const value = { flightId: "SK1", seats: 2 };
    const text = valueToJsonText(value);
    const parsed = parseJsonEditor(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.value).toEqual(value);

    const next = setAtPath(value, "/seats", 3) as { seats: number };
    expect(next.seats).toBe(3);
  });

  test("response schema diff surfaces missing / extra fields", () => {
    const out = FLOWS_TEST_MANIFEST.flows!["bookings.create"]!.out as Record<string, unknown>;
    expect(diffAgainstSchema(out, { id: "b1" })).toEqual({
      missing: [],
      extra: [],
    });
    expect(diffAgainstSchema(out, {})).toEqual({
      missing: ["id"],
      extra: [],
    });
    expect(diffAgainstSchema(out, { id: "b1", surprise: true }).extra).toContain("surprise");
  });
});
