/**
 * AI boot binder — shared driver switch + fail-loud resolution.
 */

import { describe, expect, test } from "bun:test";
import { mockAiDriver } from "../../drivers/ai-mock.ts";
import { openaiCompatibleAiDriver } from "../../drivers/ai-openai-compatible.ts";
import { aiDriverFor, bindAi, openDefaultsFor, resolveAiDriverId } from "./ai.ts";

describe("ai boot binder", () => {
  test("aiDriverFor maps protocol ids; unknown / reserved throw", () => {
    expect(aiDriverFor("mock").id).toBe("mock");
    expect(aiDriverFor("openai-compatible")).toBe(openaiCompatibleAiDriver);
    expect(() => aiDriverFor("ollama")).toThrow(/unknown AI driver/);
    expect(() => aiDriverFor("bedrock")).toThrow(/not implemented/);
    expect(() => aiDriverFor("nope")).toThrow(/unknown AI driver/);
  });

  test("resolveAiDriverId defaults to mock; honours config + OKE_AI_DRIVER in docker", () => {
    expect(resolveAiDriverId({}, "test")).toBe("mock");
    expect(
      resolveAiDriverId(
        { config: { drivers: { ai: { test: "openai-compatible" } } } },
        "test",
      ),
    ).toBe("openai-compatible");

    const prev = process.env.OKE_AI_DRIVER;
    process.env.OKE_AI_DRIVER = "openai-compatible";
    try {
      expect(resolveAiDriverId({}, "test", true)).toBe("openai-compatible");
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

  test("openDefaultsFor openai-compatible allows docker without OKE_AI_URL (cloud registry)", () => {
    const prevUrl = process.env.OKE_AI_URL;
    const prevBase = process.env.OPENAI_BASE_URL;
    delete process.env.OKE_AI_URL;
    delete process.env.OPENAI_BASE_URL;
    try {
      expect(openDefaultsFor("openai-compatible", true)).toEqual({});
    } finally {
      if (prevUrl !== undefined) process.env.OKE_AI_URL = prevUrl;
      if (prevBase !== undefined) process.env.OPENAI_BASE_URL = prevBase;
    }
  });

  test("openDefaultsFor openai-compatible keeps compose URL when present", () => {
    const prevUrl = process.env.OKE_AI_URL;
    const prevBase = process.env.OPENAI_BASE_URL;
    process.env.OKE_AI_URL = "http://127.0.0.1:8080/v1";
    delete process.env.OPENAI_BASE_URL;
    try {
      expect(openDefaultsFor("openai-compatible", true)).toEqual({
        baseUrl: "http://127.0.0.1:8080/v1",
      });
    } finally {
      if (prevUrl === undefined) delete process.env.OKE_AI_URL;
      else process.env.OKE_AI_URL = prevUrl;
      if (prevBase !== undefined) process.env.OPENAI_BASE_URL = prevBase;
    }
  });

  test("bindAi uses injected defaultDriver over config (tests stay on mock)", () => {
    const runtime = bindAi(
      {
        config: { drivers: { ai: { test: "openai-compatible" } } },
        ai: { defaultDriver: mockAiDriver },
      },
      undefined,
      () => 0,
      "test",
    );
    expect(runtime.autoCacheDisabled).toBe(true);
  });
});
