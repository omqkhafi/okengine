/**
 * Interactive Clack prompts for `oke ai setup` / create-oke AI wizard.
 */

import { isCancel, password, select, text } from "@clack/prompts";
import {
  CLOUD_PROVIDERS,
  aiProviderSelectOptions,
  cloudChatModels,
  recommendCloudChat,
} from "./catalog.ts";
import type { AiSetupApplyInput } from "./apply.ts";

/** Provider menu value (cloud + host-side OpenAI-compatible). */
export type AiSetupProvider =
  | "openrouter"
  | "openai"
  | "anthropic"
  | "groq"
  | "together"
  | "deepseek"
  | "mistral"
  | "xai"
  | "deepinfra"
  | "meta"
  | "vercel"
  | "gemini"
  | "lmstudio"
  | "custom";

/** Sentinel for Back in AI setup selects. */
const BACK = "__back__" as const;
type Back = typeof BACK;

/**
 * Run the interactive AI setup prompts.
 *
 * @param options - Preselected provider
 * @returns Apply input or null on cancel
 */
export async function askAiSetup(
  options: {
    readonly provider?: string;
  } = {},
): Promise<AiSetupApplyInput | null> {
  const rawProvider = options.provider?.trim() ?? "";
  let provider: AiSetupProvider | undefined =
    rawProvider === "" || rawProvider === "mock" ? undefined : (rawProvider as AiSetupProvider);

  if (!provider) {
    const value = await select({
      message: "AI Provider",
      options: [...aiProviderSelectOptions()],
      initialValue: "openrouter",
    });
    if (isCancel(value)) return null;
    provider = String(value) as AiSetupProvider;
  }

  return askCloudPath(provider);
}

/**
 * Cloud / openai-compatible path — API token → Select model / Manual.
 *
 * @param provider - Menu provider
 */
async function askCloudPath(provider: AiSetupProvider): Promise<AiSetupApplyInput | null> {
  const meta = CLOUD_PROVIDERS.find((p) => p.value === provider);
  if (!meta) {
    throw new Error(`oke ai setup: unknown cloud provider "${provider}"`);
  }
  const driver = meta.driver;
  const declProvider = meta.provider ?? meta.value;

  let baseUrl: string | undefined = meta.baseUrl;
  const needsUrlPrompt = meta.promptBaseUrl === true || (baseUrl === undefined && driver !== "anthropic");
  if (needsUrlPrompt) {
    const urlValue = await text({
      message: "OpenAI-compatible base URL",
      placeholder: baseUrl ?? "https://api.example.com/v1",
      initialValue: baseUrl ?? "",
      validate: (v) => {
        if (!v?.trim()) return "Base URL is required for this provider";
        return undefined;
      },
    });
    if (isCancel(urlValue)) return null;
    baseUrl = String(urlValue).trim();
  }

  const apiKeyEnv = meta.apiKeyEnv;
  let apiKey: string | undefined;
  if (apiKeyEnv) {
    const token = await password({
      message: `API token (${apiKeyEnv})`,
      validate: (v) => {
        if (!v?.trim()) return "API token is required";
        return undefined;
      },
    });
    if (isCancel(token)) return null;
    apiKey = String(token).trim();
  }

  const finish = (chatModel: string): AiSetupApplyInput => {
    // Registry openai-compat: omit baseUrl so ai.model auto-resolves.
    const omitBase = meta.baseUrl !== undefined && !meta.promptBaseUrl && driver === "openai-compatible";
    return {
      driver,
      provider: declProvider,
      ...(omitBase || baseUrl === undefined ? {} : { baseUrl }),
      chatModel,
      visionModel: null,
      embedModel: null,
      ...(apiKeyEnv ? { apiKeyEnv, ...(apiKey ? { apiKey } : {}) } : {}),
    };
  };

  for (;;) {
    const models = cloudChatModels(provider);
    const selectHint =
      provider === "openrouter"
        ? "routers + popular models"
        : `up to ${Math.min(10, Math.max(models.length, 1))} curated models`;
    const mode = await selectWithBack(
      "How do you want to pick models?",
      [
        {
          value: "select",
          label: "Select model",
          hint: selectHint,
        },
        {
          value: "manual",
          label: "Manual model",
          hint: "type any model id",
        },
      ],
      "select",
      false,
    );
    if (mode === null) return null;

    if (mode === "manual") {
      const id = await askOtherModelId(recommendCloudChat(provider));
      if (id === null) return null;
      return finish(id);
    }

    if (models.length === 0) {
      const id = await askOtherModelId(recommendCloudChat(provider));
      if (id === null) return null;
      return finish(id);
    }

    const initial = recommendCloudChat(provider);
    const chat = await selectWithBack(
      "Select model",
      models.map((m) => ({
        value: m.id,
        label: m.label,
        hint: m.hint,
      })),
      models.some((m) => m.id === initial) ? initial : models[0]!.id,
      true,
    );
    if (chat === null) return null;
    if (chat === BACK) continue;

    return finish(chat);
  }
}

/**
 * Select with optional trailing Back.
 */
async function selectWithBack(
  message: string,
  options: readonly { value: string; label: string; hint?: string }[],
  initialValue: string,
  allowBack: boolean,
): Promise<string | Back | null> {
  const list = [...options, ...(allowBack ? [{ value: BACK, label: "Back" }] : [])];
  const value = await select({ message, options: list, initialValue });
  if (isCancel(value)) return null;
  const picked = String(value);
  if (picked === BACK) return BACK;
  return picked;
}

/**
 * Ask for a custom model id.
 *
 * @param placeholder - Example id
 */
async function askOtherModelId(placeholder: string): Promise<string | null> {
  const value = await text({
    message: "Model name",
    placeholder,
    initialValue: "",
    validate: (v) => {
      if (!v?.trim()) return "Model name is required";
      return undefined;
    },
  });
  if (isCancel(value)) return null;
  return String(value).trim();
}
