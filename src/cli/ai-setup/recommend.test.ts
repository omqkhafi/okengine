/**
 * Smart Ollama recommendation — RAM tiers (no needs quiz).
 */

import { describe, expect, test } from "bun:test";
import { modelsForTier, recommendChatModel, recommendForTier } from "./catalog.ts";
import {
  fittingChatModels,
  formatModelRow,
  formatOllamaBanner,
  isTightFit,
  modelFitsComfortably,
  modelFitsOnMachine,
  recommendChatForNeeds,
  suggestTierForRam,
  usableRamGb,
} from "./recommend.ts";

describe("modelFitsOnMachine", () => {
  test("catalog ramGb is machine tier, not download size", () => {
    expect(
      modelFitsOnMachine(
        {
          id: "x",
          label: "x",
          hint: "",
          role: "chat",
          ramGb: 16,
          tier: "balanced",
          modalities: ["text"],
        },
        24,
      ),
    ).toBe(true);
    expect(
      modelFitsOnMachine(
        {
          id: "x",
          label: "x",
          hint: "",
          role: "chat",
          ramGb: 32,
          tier: "smart",
          modalities: ["text"],
        },
        24,
      ),
    ).toBe(false);
  });
});

describe("tiers", () => {
  test("each tier exposes up to 10 models", () => {
    for (const tier of ["ultra-fast", "fast", "balanced", "smart"] as const) {
      expect(modelsForTier(tier).length).toBeGreaterThan(0);
      expect(modelsForTier(tier).length).toBeLessThanOrEqual(10);
    }
  });

  test("suggestTierForRam maps fit budget", () => {
    expect(suggestTierForRam(4)).toBe("ultra-fast");
    expect(suggestTierForRam(8)).toBe("fast");
    expect(suggestTierForRam(16)).toBe("balanced");
    expect(suggestTierForRam(32)).toBe("smart");
  });

  test("recommendForTier returns a model in that tier", () => {
    const pick = recommendForTier("fast", 16);
    expect(pick.tier).toBe("fast");
  });
});

describe("recommendChatForNeeds", () => {
  test("8GB → ultra-fast or fast entry", () => {
    const pick = recommendChatForNeeds(8);
    expect(pick.ramGb).toBeLessThanOrEqual(8);
  });

  test("16GB → never recommends 32GB-class", () => {
    const pick = recommendChatForNeeds(16);
    expect(pick.ramGb).toBeLessThanOrEqual(16);
    expect(pick.id).not.toBe("qwen3.5:27b");
  });

  test("24GB leaves headroom", () => {
    const pick = recommendChatForNeeds(24);
    expect(pick.ramGb).toBeLessThanOrEqual(usableRamGb(24));
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
    expect(recommendChatModel(8).ramGb).toBeLessThanOrEqual(8);
    expect(recommendChatModel(16).ramGb).toBeLessThanOrEqual(16);
    expect(recommendChatModel(24).ramGb).toBeLessThanOrEqual(16);
  });
});

describe("formatOllamaBanner", () => {
  test("shows OS · CPU · RAM · Fit RAM · detected — no comfortable list", () => {
    const text = formatOllamaBanner({ osName: "macOS", cpuCount: 10, ramGb: 24 }, ["gemma4:e4b"]);
    expect(text).toContain("OS macOS  ·  CPU 10  ·  RAM ~24GB RAM");
    expect(text).toContain("Fit RAM ~20GB RAM");
    expect(text).toContain("Detected local models");
    expect(text).toContain("gemma4:e4b");
    expect(text).not.toContain("Fits comfortably");
    expect(text).toContain("Tiers  ·  Ultra Fast");
  });
});

describe("formatModelRow", () => {
  test("equal spacing between name · RAM · modalities", () => {
    const row = formatModelRow({
      id: "x",
      label: "Gemma 4 4B",
      hint: "",
      role: "chat",
      ramGb: 8,
      tier: "fast",
      modalities: ["text", "code"],
    });
    expect(row).toBe("Gemma 4 4B  ·  ≈8GB  ·  text  ·  code");
  });
});
