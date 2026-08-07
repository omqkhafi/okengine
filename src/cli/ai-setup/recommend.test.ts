/**
 * Smart Ollama recommendation — RAM tiers (no needs quiz).
 */

import { describe, expect, test } from "bun:test";
import {
  LLAMA_CPP_CHAT_MODELS,
  llamaCppModelsForTier,
  modelsForTier,
  recommendChatModel,
  recommendForTier,
  recommendLlamaCppForTier,
} from "./catalog.ts";
import {
  fittingChatModels,
  formatLlamaCppBanner,
  formatModelRow,
  formatModelTableHeader,
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

describe("llama.cpp catalog", () => {
  test("each tier has ≥10 curated Docker Hub ai/ models (UI shows up to 20)", () => {
    for (const tier of ["ultra-fast", "fast", "balanced", "smart"] as const) {
      const all = LLAMA_CPP_CHAT_MODELS.filter((m) => m.tier === tier);
      expect(all.length).toBeGreaterThanOrEqual(10);
      const list = llamaCppModelsForTier(tier);
      expect(list.length).toBeGreaterThanOrEqual(10);
      expect(list.length).toBeLessThanOrEqual(20);
      expect(list.length).toBe(Math.min(all.length, 20));
      expect(list.every((m) => !m.id.startsWith("ai/"))).toBe(true);
      for (let i = 1; i < list.length; i++) {
        expect(list[i]!.ramGb).toBeGreaterThanOrEqual(list[i - 1]!.ramGb);
      }
    }
  });

  test("recommendLlamaCppForTier returns a model in that tier", () => {
    expect(recommendLlamaCppForTier("ultra-fast", 8).id).toBe("smollm2");
    expect(recommendLlamaCppForTier("fast", 16).tier).toBe("fast");
  });

  test("visible list surfaces Gemma 4 and Qwen", () => {
    const ids = (tier: "fast" | "balanced" | "smart") =>
      llamaCppModelsForTier(tier).map((m) => m.id);
    expect(ids("fast").some((id) => id.startsWith("gemma4:"))).toBe(true);
    expect(ids("fast").some((id) => id.startsWith("qwen"))).toBe(true);
    expect(ids("balanced")).toContain("gemma4:e4b");
    expect(ids("balanced").some((id) => id.startsWith("qwen3"))).toBe(true);
    expect(ids("smart")).toContain("gemma4:31b");
    expect(ids("smart").some((id) => id.startsWith("qwen"))).toBe(true);
  });

  test("formatLlamaCppBanner shows Docker Hub ai/ source — not Ollama detect", () => {
    const text = formatLlamaCppBanner({ osName: "macOS", cpuCount: 10, ramGb: 24 });
    expect(text).toContain("OS macOS  ·  CPU 10  ·  RAM ~24GB RAM");
    expect(text).toContain("Fit RAM ~20GB RAM");
    expect(text).toContain("Docker Hub ai/");
    expect(text).not.toContain("Detected local models");
    expect(text).toContain("Tiers  ·  Ultra Fast");
  });
});

describe("formatModelRow", () => {
  test("aligned Model | RAM | Caps columns", () => {
    const row = formatModelRow({
      id: "x",
      label: "Gemma 4 4B",
      hint: "",
      role: "chat",
      ramGb: 8,
      tier: "fast",
      modalities: ["text", "code"],
    });
    const header = formatModelTableHeader();
    expect(header.startsWith("Model")).toBe(true);
    expect(header).toContain("RAM");
    expect(header).toContain("Caps");
    // Caps column starts at the same offset as the header.
    expect(row.indexOf("text")).toBe(header.indexOf("Caps"));
    expect(row).toContain("Gemma 4 4B");
    expect(row).toContain("≈8GB");
    expect(row).toContain("text · code");
    expect(row).not.toContain("  ·  ≈");
  });
});
