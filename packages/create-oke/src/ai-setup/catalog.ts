/**
 * Curated cloud model catalog for `oke ai setup` / create-oke AI wizard.
 */

/** Thin cloud / host-side provider menu. */
export type CloudProviderMenuEntry = {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
  readonly driver: "openai-compatible" | "anthropic";
  /** Registry / declare provider name (defaults to `value`). */
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly apiKeyEnv?: string;
  /** When true, wizard asks for base URL even if a default exists. */
  readonly promptBaseUrl?: boolean;
};

/**
 * Cloud / openai-compatible menu — URLs from the verified provider registry
 * where known; Anthropic stays native.
 */
export const CLOUD_PROVIDERS: readonly CloudProviderMenuEntry[] = [
  {
    value: "openrouter",
    label: "OpenRouter",
    hint: "recommended · zero Docker · openrouter/free",
    driver: "openai-compatible",
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENROUTER_API_KEY",
  },
  {
    value: "openai",
    label: "OpenAI",
    driver: "openai-compatible",
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    hint: "native Messages API",
    driver: "anthropic",
    provider: "anthropic",
    baseUrl: undefined,
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    value: "groq",
    label: "Groq",
    driver: "openai-compatible",
    baseUrl: "https://api.groq.com/openai/v1",
    apiKeyEnv: "GROQ_API_KEY",
  },
  {
    value: "together",
    label: "Together AI",
    driver: "openai-compatible",
    baseUrl: "https://api.together.ai/v1",
    apiKeyEnv: "TOGETHER_API_KEY",
  },
  {
    value: "deepseek",
    label: "DeepSeek",
    driver: "openai-compatible",
    baseUrl: "https://api.deepseek.com",
    apiKeyEnv: "DEEPSEEK_API_KEY",
  },
  {
    value: "mistral",
    label: "Mistral",
    driver: "openai-compatible",
    baseUrl: "https://api.mistral.ai/v1",
    apiKeyEnv: "MISTRAL_API_KEY",
  },
  {
    value: "xai",
    label: "xAI (Grok)",
    driver: "openai-compatible",
    baseUrl: "https://api.x.ai/v1",
    apiKeyEnv: "XAI_API_KEY",
  },
  {
    value: "deepinfra",
    label: "DeepInfra",
    driver: "openai-compatible",
    baseUrl: "https://api.deepinfra.com/v1/openai",
    apiKeyEnv: "DEEPINFRA_API_KEY",
  },
  {
    value: "meta",
    label: "Meta Model API",
    hint: "Muse Spark",
    driver: "openai-compatible",
    baseUrl: "https://api.meta.ai/v1",
    apiKeyEnv: "MODEL_API_KEY",
  },
  {
    value: "vercel",
    label: "Vercel AI Gateway",
    driver: "openai-compatible",
    baseUrl: "https://ai-gateway.vercel.sh/v1",
    apiKeyEnv: "AI_GATEWAY_API_KEY",
  },
  {
    value: "gemini",
    label: "Google Gemini",
    hint: "Limited OpenAI-compat — tool schemas constrained",
    driver: "openai-compatible",
    provider: "gemini",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
    apiKeyEnv: "GEMINI_API_KEY",
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    driver: "openai-compatible",
    provider: "openai-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKeyEnv: undefined,
  },
  {
    value: "custom",
    label: "Custom OpenAI Compatible",
    hint: "requires base URL",
    driver: "openai-compatible",
    provider: "openai-compatible",
    baseUrl: undefined,
    apiKeyEnv: "OPENAI_API_KEY",
    promptBaseUrl: true,
  },
];

/** One row in the AI Provider select. */
export type AiProviderSelectOption = {
  readonly value: string;
  readonly label: string;
  readonly hint?: string;
};

/**
 * AI Provider menu — OpenRouter first (recommended), then other cloud,
 * then optional mock.
 *
 * @param options - Include Mock (create-oke Customize)
 */
export function aiProviderSelectOptions(
  options: { readonly includeMock?: boolean } = {},
): readonly AiProviderSelectOption[] {
  const cloud = CLOUD_PROVIDERS.map((p) => ({
    value: p.value,
    label: p.label,
    ...(p.hint !== undefined ? { hint: p.hint } : {}),
  }));
  const mock: readonly AiProviderSelectOption[] = options.includeMock
    ? [{ value: "mock", label: "Mock (dev only)", hint: "no network" }]
    : [];
  return [...cloud, ...mock];
}

/**
 * Protocol driver for an AI Provider menu id.
 *
 * @param provider - Menu value
 */
export function aiDriverForMenuProvider(provider: string): string {
  if (provider === "mock") return "mock";
  return CLOUD_PROVIDERS.find((p) => p.value === provider)?.driver ?? "openai-compatible";
}

/** Cloud chat model entry (no RAM tier). */
export type CloudModel = {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly recommended?: boolean;
};

/** Up to 10 curated / “latest” chat models per cloud provider. */
export const CLOUD_CHAT_MODELS: Readonly<Record<string, readonly CloudModel[]>> = {
  openai: [
    { id: "gpt-4.1-nano", label: "GPT-4.1 nano", hint: "Fastest · cheapest" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini", hint: "Fast · cheap" },
    { id: "gpt-4o-mini", label: "GPT-4o mini", hint: "Fast default", recommended: true },
    { id: "gpt-4.1", label: "GPT-4.1", hint: "Latest flagship" },
    { id: "gpt-4o", label: "GPT-4o", hint: "Strong general / vision" },
    { id: "o4-mini", label: "o4-mini", hint: "Reasoning · lower cost" },
    { id: "o3-mini", label: "o3-mini", hint: "Reasoning" },
    { id: "o3", label: "o3", hint: "Deep reasoning" },
    { id: "gpt-4.1-mini-2025-04-14", label: "GPT-4.1 mini (dated)", hint: "Pinned snapshot" },
    { id: "chatgpt-4o-latest", label: "ChatGPT-4o latest", hint: "ChatGPT-aligned" },
  ],
  anthropic: [
    {
      id: "claude-haiku-4-20250514",
      label: "Claude Haiku 4",
      hint: "Fast · cheap",
    },
    {
      id: "claude-sonnet-4-20250514",
      label: "Claude Sonnet 4",
      hint: "Balanced default",
      recommended: true,
    },
    {
      id: "claude-opus-4-20250514",
      label: "Claude Opus 4",
      hint: "Highest quality",
    },
    {
      id: "claude-3-7-sonnet-20250219",
      label: "Claude 3.7 Sonnet",
      hint: "Prior mid-tier",
    },
    {
      id: "claude-3-5-haiku-20241022",
      label: "Claude 3.5 Haiku",
      hint: "Prior Haiku",
    },
    {
      id: "claude-3-5-sonnet-20241022",
      label: "Claude 3.5 Sonnet",
      hint: "Prior Sonnet",
    },
    {
      id: "claude-3-opus-20240229",
      label: "Claude 3 Opus",
      hint: "Legacy Opus",
    },
    {
      id: "claude-3-haiku-20240307",
      label: "Claude 3 Haiku",
      hint: "Legacy Haiku",
    },
    {
      id: "claude-3-sonnet-20240229",
      label: "Claude 3 Sonnet",
      hint: "Legacy Sonnet",
    },
    {
      id: "claude-2.1",
      label: "Claude 2.1",
      hint: "Legacy",
    },
  ],
  gemini: [
    {
      id: "gemini-2.5-flash-lite",
      label: "Gemini 2.5 Flash-Lite",
      hint: "Fastest",
    },
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      hint: "Fast default",
      recommended: true,
    },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Higher quality" },
    { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", hint: "Prior Flash" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash-Lite", hint: "Prior Lite" },
    { id: "gemini-1.5-flash", label: "Gemini 1.5 Flash", hint: "Legacy Flash" },
    { id: "gemini-1.5-pro", label: "Gemini 1.5 Pro", hint: "Legacy Pro" },
    { id: "gemini-2.5-flash-preview", label: "Gemini 2.5 Flash preview", hint: "Preview" },
    { id: "gemini-2.5-pro-preview", label: "Gemini 2.5 Pro preview", hint: "Preview" },
    { id: "gemma-3-27b-it", label: "Gemma 3 27B IT", hint: "Open weights via API" },
  ],
  openrouter: [
    {
      id: "openrouter/free",
      label: "openrouter/free",
      hint: "Free router · zero cost",
      recommended: true,
    },
    { id: "openrouter/auto", label: "openrouter/auto", hint: "Market pick by task + cost" },
    {
      id: "openrouter/pareto-code",
      label: "openrouter/pareto-code",
      hint: "Strong coding router",
    },
    {
      id: "openrouter/fusion",
      label: "openrouter/fusion",
      hint: "Multi-model panel",
    },
    { id: "openai/gpt-4o-mini", label: "GPT-4o mini", hint: "via OpenRouter" },
    { id: "openai/gpt-4.1", label: "GPT-4.1", hint: "via OpenRouter" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "via OpenRouter" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "via OpenRouter" },
    { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", hint: "via OpenRouter" },
    { id: "deepseek/deepseek-r1", label: "DeepSeek R1", hint: "via OpenRouter" },
  ],
  groq: [
    {
      id: "llama-3.1-8b-instant",
      label: "Llama 3.1 8B Instant",
      hint: "Fast default",
      recommended: true,
    },
    { id: "llama-3.3-70b-versatile", label: "Llama 3.3 70B", hint: "Higher quality" },
    { id: "mixtral-8x7b-32768", label: "Mixtral 8x7B", hint: "Long context" },
  ],
  together: [
    {
      id: "meta-llama/Meta-Llama-3.1-8B-Instruct-Turbo",
      label: "Llama 3.1 8B Turbo",
      hint: "Fast",
      recommended: true,
    },
    {
      id: "meta-llama/Meta-Llama-3.1-70B-Instruct-Turbo",
      label: "Llama 3.1 70B Turbo",
      hint: "Higher quality",
    },
  ],
  deepseek: [
    {
      id: "deepseek-v4-flash",
      label: "DeepSeek V4 Flash",
      hint: "Fast default",
      recommended: true,
    },
    { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro", hint: "Higher quality" },
  ],
  mistral: [
    {
      id: "mistral-small-latest",
      label: "Mistral Small",
      hint: "Fast default",
      recommended: true,
    },
    { id: "mistral-large-latest", label: "Mistral Large", hint: "Higher quality" },
  ],
  xai: [
    { id: "grok-4.6", label: "Grok 4.6", hint: "Current default", recommended: true },
    { id: "grok-3-mini", label: "Grok 3 Mini", hint: "Faster / cheaper" },
  ],
  deepinfra: [
    {
      id: "meta-llama/Meta-Llama-3.1-8B-Instruct",
      label: "Llama 3.1 8B",
      hint: "Fast",
      recommended: true,
    },
  ],
  meta: [
    {
      id: "muse-spark-1.2",
      label: "Muse Spark",
      hint: "Meta Model API",
      recommended: true,
    },
  ],
  vercel: [
    {
      id: "openai/gpt-4o-mini",
      label: "GPT-4o mini",
      hint: "via AI Gateway",
      recommended: true,
    },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "via AI Gateway" },
  ],
  lmstudio: [
    {
      id: "local-model",
      label: "local-model",
      hint: "LM Studio loaded model id",
      recommended: true,
    },
  ],
  custom: [
    {
      id: "default",
      label: "default",
      hint: "Whatever your endpoint expects",
      recommended: true,
    },
  ],
};

/**
 * Curated chat models for a cloud provider (deduped, ≤10).
 *
 * @param provider - Menu provider id
 */
export function cloudChatModels(provider: string): readonly CloudModel[] {
  const list = CLOUD_CHAT_MODELS[provider] ?? [];
  const seen = new Set<string>();
  const out: CloudModel[] = [];
  for (const m of list) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    out.push(m);
    if (out.length >= 10) break;
  }
  return out;
}

/**
 * Recommended cloud chat model id for a provider.
 *
 * @param provider - Menu provider id
 */
export function recommendCloudChat(provider: string): string {
  const list = cloudChatModels(provider);
  return list.find((m) => m.recommended)?.id ?? list[0]?.id ?? "gpt-4o-mini";
}

/**
 * Resolve apply fields for a cloud menu id (interactive + `--yes`).
 *
 * @param menuValue - CLOUD_PROVIDERS value
 * @param overrides - Chat model / API key / base URL overrides
 */
export function cloudApplyDefaults(
  menuValue: string,
  overrides: {
    readonly chatModel?: string;
    readonly apiKey?: string;
    readonly baseUrl?: string;
  } = {},
): {
  readonly driver: "openai-compatible" | "anthropic";
  readonly provider: string;
  readonly baseUrl?: string;
  readonly chatModel: string;
  readonly visionModel: null;
  readonly embedModel: null;
  readonly apiKeyEnv?: string;
  readonly apiKey?: string;
} {
  const meta = CLOUD_PROVIDERS.find((p) => p.value === menuValue);
  if (!meta) {
    throw new Error(`oke ai setup: unknown cloud provider "${menuValue}"`);
  }
  const provider = meta.provider ?? meta.value;
  const registryKnown = new Set([
    "openai", "openrouter", "groq", "together", "deepinfra", "meta", "xai",
    "mistral", "deepseek", "vercel", "google", "gemini", "anthropic",
  ]);
  // Registry openai-compat: omit baseUrl so ai.model auto-resolves.
  const omitBase = registryKnown.has(provider) && meta.driver === "openai-compatible";
  const baseUrl = omitBase ? undefined : (overrides.baseUrl ?? meta.baseUrl);
  return {
    driver: meta.driver,
    provider,
    ...(baseUrl !== undefined ? { baseUrl } : {}),
    chatModel: overrides.chatModel ?? recommendCloudChat(menuValue),
    visionModel: null,
    embedModel: null,
    ...(meta.apiKeyEnv
      ? {
          apiKeyEnv: meta.apiKeyEnv,
          ...(overrides.apiKey ? { apiKey: overrides.apiKey } : {}),
        }
      : {}),
  };
}
