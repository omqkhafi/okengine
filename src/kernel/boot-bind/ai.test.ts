/**
 * AI boot binder — shared driver switch + fail-loud resolution.
 */

import { describe, expect, test } from "bun:test";
import { mockAiDriver } from "../../drivers/ai-mock.ts";
import { ollamaAiDriver } from "../../drivers/ai-ollama.ts";
import { aiDriverFor, aiUrlFor, bindAi, resolveAiDriverId } from "./ai.ts";

describe("ai boot binder", () => {
  test("aiDriverFor maps protocol ids; unknown / reserved throw", () => {
    expect(aiDriverFor("mock").id).toBe("mock");
    expect(aiDriverFor("ollama")).toBe(ollamaAiDriver);
    expect(() => aiDriverFor("bedrock")).toThrow(/not implemented/);
    expect(() => aiDriverFor("nope")).toThrow(/unknown AI driver/);
  });

  test("resolveAiDriverId defaults to mock; honours config + OKE_AI_DRIVER in docker", () => {
    expect(resolveAiDriverId({}, "test")).toBe("mock");
    expect(resolveAiDriverId({ config: { drivers: { ai: { test: "ollama" } } } }, "test")).toBe(
      "ollama",
    );

    const prev = process.env.OKE_AI_DRIVER;
    process.env.OKE_AI_DRIVER = "ollama";
    try {
      expect(resolveAiDriverId({}, "test", true)).toBe("ollama");
    } finally {
      if (prev === undefined) delete process.env.OKE_AI_DRIVER;
      else process.env.OKE_AI_DRIVER = prev;
    }
  });

  test("aiUrlFor fails loud in docker without OKE_AI_URL", () => {
    const prevUrl = process.env.OKE_AI_URL;
    const prevHost = process.env.OLLAMA_HOST;
    delete process.env.OKE_AI_URL;
    delete process.env.OLLAMA_HOST;
    try {
      expect(() => aiUrlFor(true)).toThrow(/OKE_AI_URL/);
      expect(aiUrlFor(false)).toBe("http://127.0.0.1:11434");
    } finally {
      if (prevUrl !== undefined) process.env.OKE_AI_URL = prevUrl;
      if (prevHost !== undefined) process.env.OLLAMA_HOST = prevHost;
    }
  });

  test("bindAi uses injected defaultDriver over config (tests stay on mock)", () => {
    const runtime = bindAi(
      {
        config: { drivers: { ai: { test: "ollama" } } },
        ai: { defaultDriver: mockAiDriver },
      },
      undefined,
      () => 0,
      "test",
    );
    expect(runtime.autoCacheDisabled).toBe(true);
  });
});
