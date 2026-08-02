/**
 * Smart Ollama recommendation scoring + RAM tier rules.
 */

import { describe, expect, test } from "bun:test";
import { recommendChatModel } from "./catalog.ts";
import {
  fittingChatModels,
  formatMachineSummary,
  isTightFit,
  modelFitsComfortably,
  modelFitsOnMachine,
  recommendChatForNeeds,
  type AiNeeds,
} from "./recommend.ts";

const balanced: AiNeeds = {
  useCase: "balanced",
  priority: "balanced",
  wantVision: false,
};

describe("modelFitsOnMachine", () => {
  test("catalog ramGb is machine tier, not download size", () => {
    expect(modelFitsOnMachine({ id: "x", label: "x", hint: "", role: "chat", ramGb: 16 }, 24)).toBe(
      true,
    );
    expect(modelFitsOnMachine({ id: "x", label: "x", hint: "", role: "chat", ramGb: 32 }, 24)).toBe(
      false,
    );
  });
});

describe("recommendChatForNeeds", () => {
  test("8GB → entry-level only", () => {
    const pick = recommendChatForNeeds(8, balanced);
    expect(pick.id).toBe("gemma4:e4b");
    expect(pick.ramGb).toBeLessThanOrEqual(8);
  });

  test("16GB → never recommends 27b / 32GB-class", () => {
    const pick = recommendChatForNeeds(16, { ...balanced, useCase: "coding", priority: "quality" });
    expect(pick.ramGb).toBeLessThanOrEqual(16);
    expect(pick.id).not.toBe("qwen3.5:27b");
  });

  test("24GB does not treat full RAM as model size", () => {
    const pick = recommendChatForNeeds(24, balanced);
    // Must leave headroom — not a fictional "24GB model"
    expect(pick.ramGb).toBeLessThan(24);
    expect(pick.ramGb).toBeLessThanOrEqual(16);
    const summary = formatMachineSummary(24, pick);
    expect(summary).toContain("Your machine: ~24GB");
    expect(summary).toContain(`${pick.ramGb}GB-class`);
    expect(summary).not.toMatch(/download a 24GB/i);
  });

  test("coding preference leans Qwen when it fits", () => {
    const pick = recommendChatForNeeds(24, {
      useCase: "coding",
      priority: "balanced",
      wantVision: false,
    });
    expect(pick.id.startsWith("qwen")).toBe(true);
  });

  test("reasoning preference leans DeepSeek when it fits", () => {
    const pick = recommendChatForNeeds(16, {
      useCase: "reasoning",
      priority: "balanced",
      wantVision: false,
    });
    expect(pick.id).toContain("deepseek");
  });
});

describe("comfortable vs tight", () => {
  test("16GB-class on 16GB machine is tight", () => {
    const qwen = fittingChatModels(16).find((m) => m.id === "qwen3.5:9b");
    expect(qwen).toBeDefined();
    expect(modelFitsOnMachine(qwen!, 16)).toBe(true);
    expect(modelFitsComfortably(qwen!, 16)).toBe(false);
    expect(isTightFit(qwen!, 16)).toBe(true);
  });

  test("16GB-class on 24GB machine is comfortable", () => {
    const qwen = fittingChatModels(24).find((m) => m.id === "qwen3.5:9b")!;
    expect(modelFitsComfortably(qwen, 24)).toBe(true);
    expect(isTightFit(qwen, 24)).toBe(false);
  });
});

describe("recommendChatModel", () => {
  test("respects tiers with headroom preference", () => {
    expect(recommendChatModel(8).id).toBe("gemma4:e4b");
    expect(recommendChatModel(16).ramGb).toBeLessThanOrEqual(16);
    expect(recommendChatModel(24).ramGb).toBeLessThanOrEqual(16);
    expect(recommendChatModel(null).recommended).toBe(true);
  });
});
