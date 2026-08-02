/**
 * Convert persisted create-defaults AI prefs ↔ apply input.
 */

import type { CreateAiPref } from "../create-defaults.ts";
import type { AiSetupApplyInput } from "./apply.ts";

/**
 * Build apply input from saved create-defaults (reuse path).
 *
 * @param pref - Saved AI preference
 */
export function applyInputFromAiPref(pref: CreateAiPref): AiSetupApplyInput | null {
  if (!pref.enabled || !pref.driver) return null;
  const driver = pref.driver as AiSetupApplyInput["driver"];
  if (
    driver !== "ollama" &&
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
  if (provider === "ollama") {
    return {
      driver: "ollama",
      baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:11434",
      chatModel: "gemma4:e4b",
      visionModel: "qwen3-vl:4b",
      embedModel: "nomic-embed-text",
    };
  }
  if (provider === "anthropic") {
    return {
      driver: "anthropic",
      chatModel: "claude-sonnet-4-20250514",
      visionModel: null,
      embedModel: null,
      apiKeyEnv: "ANTHROPIC_API_KEY",
    };
  }
  const baseUrls: Record<string, string | undefined> = {
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    lmstudio: "http://127.0.0.1:1234/v1",
    gemini: undefined,
    custom: undefined,
  };
  return {
    driver: "openai-compatible",
    ...(baseUrls[provider] !== undefined ? { baseUrl: baseUrls[provider] } : {}),
    chatModel: "gpt-4o-mini",
    visionModel: null,
    embedModel: null,
    apiKeyEnv: "OPENAI_API_KEY",
  };
}
