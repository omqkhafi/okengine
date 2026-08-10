/**
 * AI error classification + timeout parsing.
 */

import { describe, expect, test } from "bun:test";
import { aiHttpError, isRetryableAiError, outExpectsVia, resolveTimeoutMs } from "./errors.ts";

describe("resolveTimeoutMs", () => {
  test("parses clock durations and ms numbers", () => {
    expect(resolveTimeoutMs("30s")).toBe(30_000);
    expect(resolveTimeoutMs(250)).toBe(250);
    expect(resolveTimeoutMs(undefined)).toBeUndefined();
    expect(resolveTimeoutMs("nope")).toBeUndefined();
  });
});

describe("isRetryableAiError", () => {
  test("classifies status and HTTP message", () => {
    expect(isRetryableAiError(aiHttpError("rate", 429))).toBe(true);
    expect(isRetryableAiError(aiHttpError("boom", 503))).toBe(true);
    expect(isRetryableAiError(aiHttpError("auth", 401))).toBe(false);
    expect(isRetryableAiError(new Error("openai-compatible HTTP 401"))).toBe(false);
    const abort = new Error("aborted");
    abort.name = "AbortError";
    expect(isRetryableAiError(abort)).toBe(true);
  });
});

describe("outExpectsVia", () => {
  test("detects JSON-schema and Zod-like shape", () => {
    expect(outExpectsVia({ properties: { via: { type: "string" } } })).toBe(true);
    expect(outExpectsVia({ shape: { via: {} } })).toBe(true);
    expect(outExpectsVia({ properties: { summary: { type: "string" } } })).toBe(false);
  });
});
