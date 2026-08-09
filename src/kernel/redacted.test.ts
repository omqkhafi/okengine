/**
 * Unit tests for {@link Redacted} serialization / inspect hygiene.
 */

import { describe, expect, test } from "bun:test";
import { inspect } from "node:util";
import { REDACTED_PLACEHOLDER, Redacted } from "./redacted.ts";

describe("Redacted", () => {
  test("does not leak in JSON.stringify", () => {
    const r = Redacted.of("secret");
    expect(JSON.stringify({ r })).toBe(`{"r":"${REDACTED_PLACEHOLDER}"}`);
  });

  test("does not leak in string coercion", () => {
    const r = Redacted.of("secret");
    expect(r.toString()).toBe(REDACTED_PLACEHOLDER);
    expect(r.valueOf()).toBe(REDACTED_PLACEHOLDER);
    expect(String(r)).toBe(REDACTED_PLACEHOLDER);
    expect(`${r}`).toBe(REDACTED_PLACEHOLDER);
  });

  test("does not leak in util.inspect", () => {
    const r = Redacted.of("secret");
    const inspected = inspect(r);
    expect(inspected).toContain("Redacted");
    expect(inspected).not.toContain("secret");
  });

  test("reveal and map keep the cleartext only behind reveal", () => {
    const r = Redacted.of("secret").map((v) => v.toUpperCase());
    expect(r.reveal()).toBe("SECRET");
    expect(JSON.stringify(r)).toBe(`"${REDACTED_PLACEHOLDER}"`);
  });
});
