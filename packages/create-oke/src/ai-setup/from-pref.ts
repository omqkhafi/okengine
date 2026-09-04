/**
 * Convert persisted create-defaults AI prefs ↔ apply input.
 */

import type { CreateAiPref } from "../create-defaults.ts";
import { LLAMA_CPP_IMAGE, OLLAMA_IMAGE, SGLANG_IMAGE, VLLM_IMAGE } from "../drivers-catalog.ts";
import type { AiSetupApplyInput } from "./apply.ts";
import { cloudApplyDefaults } from "./catalog.ts";

/**
 * Build apply input from saved create-defaults (reuse path).
 *
 * @param pref - Saved AI preference
 */
export function applyInputFromAiPref(pref: CreateAiPref): AiSetupApplyInput | null {
  if (!pref.enabled || !pref.driver) return null;
  const driver = pref.driver as AiSetupApplyInput["driver"];
  if (
    driver !== "anthropic" &&
    driver !== "openai-compatible" &&
    driver !== "mock"
  ) {
    return null;
  }
  return {
    driver,
    ...(pref.baseUrl ? { baseUrl: pref.baseUrl } : {}),
    ...(pref.chatModel ? { chatModel: pref.chatModel } : {}),
    ...(pref.visionModel !== undefined && pref.visionModel !== null
      ? { visionModel: pref.visionModel }
      : {}),
    ...(pref.embedModel !== undefined && pref.embedModel !== null
      ? { embedModel: pref.embedModel }
      : {}),
    ...(pref.apiKeyEnv ? { apiKeyEnv: pref.apiKeyEnv } : {}),
  };
}

/**
 * Merge model choices into a CreateAiPref for persistence.
 *
 * @param base - Provider / driver prefs
 * @param apply - Model apply input
 */
export function aiPrefWithModels(
  base: CreateAiPref,
  apply: AiSetupApplyInput | null,
): CreateAiPref {
  if (!apply) return base;
  return {
    ...base,
    driver: apply.driver,
    chatModel: apply.chatModel ?? null,
    visionModel: apply.visionModel ?? null,
    embedModel: apply.embedModel ?? null,
    baseUrl: apply.baseUrl ?? null,
    apiKeyEnv: apply.apiKeyEnv ?? null,
  };
}

/**
 * Non-interactive defaults for `--yes --ai` (mirrors `oke ai setup --yes`).
 *
 * @param provider - Menu id
 */
export function nonInteractiveAiApply(provider: string): AiSetupApplyInput {
  if (provider === "llama-cpp") {
    return {
      driver: "openai-compatible",
      provider: "openai-compatible",
      baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:8080/v1",
      chatModel: "granite3.3:2b",
      visionModel: null,
      embedModel: null,
      image: LLAMA_CPP_IMAGE,
    };
  }
  if (provider === "ollama") {
    return {
      driver: "openai-compatible",
      provider: "openai-compatible",
      baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:11434/v1",
      chatModel: "gemma4:e4b",
      visionModel: "qwen3-vl:4b",
      embedModel: "nomic-embed-text",
      image: OLLAMA_IMAGE,
    };
  }
  if (provider === "vllm") {
    return {
      driver: "openai-compatible",
      provider: "openai-compatible",
      baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:8000/v1",
      chatModel: "Qwen/Qwen3-0.6B",
      visionModel: null,
      embedModel: null,
      image: VLLM_IMAGE,
    };
  }
  if (provider === "sglang") {
    return {
      driver: "openai-compatible",
      provider: "openai-compatible",
      baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:30000/v1",
      chatModel: "Qwen/Qwen3-0.6B",
      visionModel: null,
      embedModel: null,
      image: SGLANG_IMAGE,
    };
  }
  return cloudApplyDefaults(provider);
}
