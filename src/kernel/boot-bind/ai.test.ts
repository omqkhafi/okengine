/**
 * AI boot binder — shared driver switch + fail-loud resolution.
 */

import { describe, expect, test } from "bun:test";
import { mockAiDriver } from "../../drivers/ai-mock.ts";
import { ollamaAiDriver } from "../../drivers/ai-ollama.ts";
import { aiDriverFor, aiUrlFor, bindAi, openDefaultsFor, resolveAiDriverId } from "./ai.ts";

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

  test("resolveAiDriverId does not mock when OKE_AI_URL is set (oke dev after reset)", () => {
    const prevUrl = process.env.OKE_AI_URL;
    const prevDriver = process.env.OKE_AI_DRIVER;
    process.env.OKE_AI_URL = "http://127.0.0.1:23850/v1";
    delete process.env.OKE_AI_DRIVER;
    try {
      expect(
        resolveAiDriverId(
          { config: { drivers: { ai: { test: "mock", dev: "openai-compatible" } } } },
          "test",
        ),
      ).toBe("openai-compatible");
    } finally {
      if (prevUrl === undefined) delete process.env.OKE_AI_URL;
      else process.env.OKE_AI_URL = prevUrl;
      if (prevDriver === undefined) delete process.env.OKE_AI_DRIVER;
      else process.env.OKE_AI_DRIVER = prevDriver;
    }
  });

  test("openDefaultsFor openai-compatible fails loud in docker without OKE_AI_URL", () => {
    const prevUrl = process.env.OKE_AI_URL;
    const prevBase = process.env.OPENAI_BASE_URL;
    delete process.env.OKE_AI_URL;
    delete process.env.OPENAI_BASE_URL;
    try {
      expect(() => openDefaultsFor("openai-compatible", true)).toThrow(/OKE_AI_URL/);
    } finally {
      if (prevUrl !== undefined) process.env.OKE_AI_URL = prevUrl;
      if (prevBase !== undefined) process.env.OPENAI_BASE_URL = prevBase;
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
