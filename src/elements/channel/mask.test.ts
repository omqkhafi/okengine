/**
 * Recipient PII masking.
 */

import { describe, expect, test } from "bun:test";
import { maskRecipient } from "./mask.ts";

describe("maskRecipient", () => {
  test("masks email local + domain", () => {
    expect(maskRecipient("alice@example.com")).toBe("a***@e***.com");
  });

  test("masks phone keeping prefix and last digits", () => {
    const masked = maskRecipient("+966501234567");
    expect(masked.startsWith("+966")).toBe(true);
    expect(masked.endsWith("567")).toBe(true);
    expect(masked).toContain("***");
  });
});
