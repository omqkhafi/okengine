/**
 * Masked recipient display helper.
 */

import { describe, expect, test } from "bun:test";
import { looksMasked } from "./mask.ts";

describe("looksMasked", () => {
  test("detects masked emails and phones", () => {
    expect(looksMasked("a***@e***.com")).toBe(true);
    expect(looksMasked("+966***000")).toBe(true);
    expect(looksMasked("alice@example.com")).toBe(false);
  });
});
