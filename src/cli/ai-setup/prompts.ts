/**
 * Interactive Clack prompts for `oke ai setup` / create-oke AI wizard.
 */

import { isCancel, note, password, select, text } from "@clack/prompts";
import {
  CLOUD_PROVIDERS,
  MODEL_TIERS,
  cloudChatModels,
  modelsForTier,
  recommendCloudChat,
  recommendForRole,
  recommendForTier,
  type CatalogModel,
  type ModelTier,
} from "./catalog.ts";
import type { AiSetupApplyInput } from "./apply.ts";
import {
  detectMachineInfo,
  detectOllama,
  detectTotalRamGb,
  isInstalled,
  type OllamaDetectResult,
} from "./detect-ollama.ts";
import { formatModelRow, formatOllamaBanner, suggestTierForRam } from "./recommend.ts";

/** Provider menu value. */
export type AiSetupProvider =
  | "ollama"
  | "openai"
  | "anthropic"
  | "gemini"
  | "lmstudio"
  | "openrouter"
  | "custom";

/** Sentinel for Back in AI setup selects. */
const BACK = "__back__" as const;
type Back = typeof BACK;

/**
 * Run the interactive AI setup prompts.
 *
 * @param options - Preselected provider / seams
 * @returns Apply input or null on cancel
 */
export async function askAiSetup(
  options: {
    readonly provider?: string;
    readonly detect?: () => Promise<OllamaDetectResult>;
    readonly ramGb?: number | null;
  } = {},
): Promise<AiSetupApplyInput | null> {
  const rawProvider = options.provider?.trim() ?? "";
  let provider: AiSetupProvider | undefined =
    rawProvider === "" || rawProvider === "mock" ? undefined : (rawProvider as AiSetupProvider);

  if (!provider) {
    const value = await select({
      message: "AI Provider",
      options: [
        {
          value: "ollama",
          label: "Ollama (Local)",
          hint: "detect models · recommend for your RAM",
        },
        { value: "openai", label: "OpenAI" },
        { value: "anthropic", label: "Anthropic" },
        { value: "gemini", label: "Gemini", hint: "OpenAI-compatible proxy URL" },
        { value: "lmstudio", label: "LM Studio" },
        { value: "openrouter", label: "OpenRouter" },
        { value: "custom", label: "Custom OpenAI Compatible" },
      ],
    });
    if (isCancel(value)) return null;
    provider = String(value) as AiSetupProvider;
  }

  if (provider === "ollama") {
    return askOllamaPath({
      detect: options.detect ?? detectOllama,
      ramGb: options.ramGb === undefined ? detectTotalRamGb() : options.ramGb,
    });
  }

  return askCloudPath(provider);
}

/**
 * Ollama path — banner → Select model (tier) / Manual model.
 *
 * @param options - Detect / RAM
 */
async function askOllamaPath(options: {
  readonly detect: () => Promise<OllamaDetectResult>;
  readonly ramGb: number | null;
}): Promise<AiSetupApplyInput | null> {
  const detected = await options.detect();
  const machine = detectMachineInfo();
  const ramGb = options.ramGb ?? machine.ramGb;
  const detectedIds =
    detected.installed.length > 0
      ? detected.installed.slice(0, 12)
      : detected.curatedInstalled.map((m) => m.id);

  note(formatOllamaBanner({ ...machine, ramGb }, detectedIds), "Ollama");

  mode: for (;;) {
    const mode = await selectWithBack(
      "How do you want to pick models?",
      [
        {
          value: "select",
          label: "Select model",
          hint: "Ultra Fast  ·  Fast  ·  Balanced  ·  Smart",
        },
        {
          value: "manual",
          label: "Manual model",
          hint: "type any Ollama model id",
        },
      ],
      "select",
      false,
    );
    if (mode === null) return null;

    if (mode === "manual") {
      const id = await askOtherModelId("gemma4:e4b");
      if (id === null) return null;
      return finishOllama(id, detected);
    }

    tier: for (;;) {
      const tierPick = await selectWithBack(
        "Select model",
        MODEL_TIERS.map((t) => ({
          value: t.value,
          label: t.label,
          hint: t.hint,
        })),
        suggestTierForRam(ramGb),
        true,
      );
      if (tierPick === null) return null;
      if (tierPick === BACK) continue mode;

      const tier = tierPick as ModelTier;
      const recommended = recommendForTier(tier, ramGb);

      how: for (;;) {
        const how = await selectWithBack(
          MODEL_TIERS.find((t) => t.value === tier)?.label ?? tier,
          [
            {
              value: "recommended",
              label: "Use recommended",
              hint: formatModelRow(recommended),
            },
            {
              value: "manual",
              label: "Select manually",
              hint: "up to 10 models in this tier",
            },
          ],
          "recommended",
          true,
        );
        if (how === null) return null;
        if (how === BACK) continue tier;

        if (how === "recommended") {
          return finishOllama(recommended.id, detected, recommended);
        }

        const list = modelsForTier(tier);
        const picked = await selectWithBack(
          "Select model",
          list.map((m) => ({
            value: m.id,
            label: formatModelRow(m),
            hint: isInstalled(m.id, detected.installed) ? "installed" : m.hint,
          })),
          recommended.id,
          true,
        );
        if (picked === null) return null;
        if (picked === BACK) continue how;
        const model = list.find((m) => m.id === picked);
        return finishOllama(picked, detected, model);
      }
    }
  }
}

/**
 * Build apply input for Ollama — embed default, optional silent pull.
 *
 * @param chatId - Chat model id
 * @param detected - Detect result
 * @param catalog - Optional catalog row (modalities)
 */
async function finishOllama(
  chatId: string,
  detected: OllamaDetectResult,
  catalog?: CatalogModel,
): Promise<AiSetupApplyInput> {
  const embed = recommendForRole("embed");
  const visionModel = catalog?.modalities.includes("vision") ? chatId : null;

  const needed = [chatId, embed.id].filter(
    (id) => detected.available && !isInstalled(id, detected.installed),
  );
  if (needed.length > 0 && detected.available) {
    await pullModels(needed, detected.baseUrl);
  }

  return {
    driver: "ollama",
    baseUrl: detected.baseUrl,
    chatModel: chatId,
    visionModel,
    embedModel: embed.id,
  };
}

/**
 * Cloud / openai-compatible path — API token → Select model / Manual.
 *
 * @param provider - Menu provider
 */
async function askCloudPath(provider: AiSetupProvider): Promise<AiSetupApplyInput | null> {
  const meta = CLOUD_PROVIDERS.find((p) => p.value === provider);
  const driver = meta?.driver ?? "openai-compatible";

  let baseUrl: string | undefined = meta?.baseUrl;
  if (provider === "custom" || provider === "gemini" || !baseUrl) {
    if (provider !== "anthropic") {
      const urlValue = await text({
        message:
          provider === "gemini"
            ? "OpenAI-compatible base URL for Gemini"
            : "OpenAI-compatible base URL",
        placeholder: baseUrl ?? "https://api.example.com/v1",
        initialValue: baseUrl ?? "",
      });
      if (isCancel(urlValue)) return null;
      const trimmed = String(urlValue).trim();
      baseUrl = trimmed.length > 0 ? trimmed : undefined;
    }
  }

  const apiKeyEnv = meta?.apiKeyEnv;
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

  for (;;) {
    const mode = await selectWithBack(
      "How do you want to pick models?",
      [
        {
          value: "select",
          label: "Select model",
          hint: "up to 10 latest curated models",
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
      return {
        driver,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        chatModel: id,
        visionModel: null,
        embedModel: null,
        ...(apiKeyEnv ? { apiKeyEnv, ...(apiKey ? { apiKey } : {}) } : {}),
      };
    }

    const models = cloudChatModels(provider);
    if (models.length === 0) {
      const id = await askOtherModelId(recommendCloudChat(provider));
      if (id === null) return null;
      return {
        driver,
        ...(baseUrl !== undefined ? { baseUrl } : {}),
        chatModel: id,
        visionModel: null,
        embedModel: null,
        ...(apiKeyEnv ? { apiKeyEnv, ...(apiKey ? { apiKey } : {}) } : {}),
      };
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

    return {
      driver,
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      chatModel: chat,
      visionModel: null,
      embedModel: null,
      ...(apiKeyEnv ? { apiKeyEnv, ...(apiKey ? { apiKey } : {}) } : {}),
    };
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

/**
 * Pull each model via the Ollama HTTP API (`POST /api/pull`).
 *
 * @param models - Model ids
 * @param baseUrl - Ollama server base URL
 */
async function pullModels(models: readonly string[], baseUrl: string): Promise<void> {
  const base = baseUrl.replace(/\/+$/, "");
  for (const id of models) {
    console.log(`ollama: pulling ${id} via ${base}/api/pull…`);
    try {
      const tags = await fetch(`${base}/api/tags`);
      if (!tags.ok) {
        throw new Error(`GET ${base}/api/tags → ${tags.status}`);
      }
      const res = await fetch(`${base}/api/pull`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: id, stream: false }),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          `POST ${base}/api/pull → ${res.status}${body ? ` ${body.slice(0, 120)}` : ""}`,
        );
      }
      await res.arrayBuffer();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`oke ai setup: pull ${id} failed (continuing) — ${msg}`);
    }
  }
}
