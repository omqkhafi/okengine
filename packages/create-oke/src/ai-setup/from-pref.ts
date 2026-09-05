/**
 * Convert persisted create-defaults AI prefs ↔ apply input.
 */

import type { CreateAiPref } from "../create-defaults.ts";
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
  return cloudApplyDefaults(provider);
}
