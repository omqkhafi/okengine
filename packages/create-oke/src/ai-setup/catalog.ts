/**
 * Curated model catalog for `oke ai setup` / create-oke AI wizard.
 *
 * Tiers map to machine RAM classes (not download size). Manual lists show
 * up to 10 entries with modalities.
 */

/** Role a model can fill in the wizard. */
export type CatalogRole = "chat" | "vision" | "embed";

/** Speed / quality tier for the Select model step. */
export type ModelTier = "ultra-fast" | "fast" | "balanced" | "smart";

/** Capability tags shown in manual model lists. */
export type ModelModality = "text" | "vision" | "code" | "reasoning";

/** One curated local model entry (Ollama tag or Docker Hub `ai/` id). */
export type CatalogModel = {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly role: CatalogRole;
  readonly recommended?: boolean;
  /** Approximate RAM (GB) needed to run comfortably (machine tier). */
  readonly ramGb: number;
  readonly tier: ModelTier;
  readonly modalities: readonly ModelModality[];
};

/** Tier menu rows (prompt labels). */
export const MODEL_TIERS: readonly {
  readonly value: ModelTier;
  readonly label: string;
  readonly hint: string;
  readonly minRamGb: number;
  readonly maxRamGb: number;
}[] = [
  {
    value: "ultra-fast",
    label: "Ultra Fast",
    hint: "~1GB–~2GB RAM",
    minRamGb: 1,
    maxRamGb: 2,
  },
  {
    value: "fast",
    label: "Fast",
    hint: "~4GB–~8GB RAM",
    minRamGb: 4,
    maxRamGb: 8,
  },
  {
    value: "balanced",
    label: "Balanced",
    hint: "~8GB–~16GB RAM",
    minRamGb: 8,
    maxRamGb: 16,
  },
  {
    value: "smart",
    label: "Smart",
    hint: "~24GB–~32GB RAM",
    minRamGb: 24,
    maxRamGb: 32,
  },
];

/** Chat / multimodal models (curated; manual pick shows ≤10 per tier). */
export const CHAT_MODELS: readonly CatalogModel[] = [
  // Ultra Fast (~1–2GB)
  {
    id: "smollm2:135m",
    label: "SmolLM2 135M",
    hint: "Tiny · on-device",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "qwen2.5:0.5b",
    label: "Qwen2.5 0.5B",
    hint: "Smallest Qwen",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "llama3.2:1b",
    label: "Llama 3.2 1B",
    hint: "Meta tiny",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "gemma3:1b",
    label: "Gemma 3 1B",
    hint: "Google tiny",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "qwen2.5:1.5b",
    label: "Qwen2.5 1.5B",
    hint: "Small coding",
    role: "chat",
    recommended: true,
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "deepseek-r1:1.5b",
    label: "DeepSeek R1 1.5B",
    hint: "Tiny reasoning",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "reasoning"],
  },
  {
    id: "moondream",
    label: "Moondream",
    hint: "Tiny vision",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "vision"],
  },
  {
    id: "tinydolphin",
    label: "TinyDolphin",
    hint: "Ultra-compact chat",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "phi3:mini",
    label: "Phi-3 Mini",
    hint: "Microsoft compact",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "stable-code:3b",
    label: "Stable Code 3B",
    hint: "Compact coder",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },

  // Fast (~4–8GB)
  {
    id: "llama3.2:3b",
    label: "Llama 3.2 3B",
    hint: "Small general",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "phi4-mini",
    label: "Phi-4 Mini",
    hint: "Strong small",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "qwen2.5:3b",
    label: "Qwen2.5 3B",
    hint: "Coding · small",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "gemma4:e4b",
    label: "Gemma 4 4B",
    hint: "Fast default",
    role: "chat",
    recommended: true,
    ramGb: 8,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "qwen2.5:7b",
    label: "Qwen2.5 7B",
    hint: "Coding workhorse",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "mistral:7b",
    label: "Mistral 7B",
    hint: "General purpose",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "deepseek-r1:7b",
    label: "DeepSeek R1 7B",
    hint: "Reasoning",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "reasoning"],
  },
  {
    id: "llava:7b",
    label: "LLaVA 7B",
    hint: "Vision-language",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "qwen3-vl:4b",
    label: "Qwen3-VL 4B",
    hint: "Vision-language",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "granite3.3:8b",
    label: "Granite 3.3 8B",
    hint: "IBM enterprise",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "code"],
  },

  // Balanced (~8–16GB)
  {
    id: "deepseek-r1:8b",
    label: "DeepSeek R1 8B",
    hint: "Strong reasoning",
    role: "chat",
    ramGb: 10,
    tier: "balanced",
    modalities: ["text", "reasoning"],
  },
  {
    id: "llama3.1:8b",
    label: "Llama 3.1 8B",
    hint: "General purpose",
    role: "chat",
    ramGb: 10,
    tier: "balanced",
    modalities: ["text"],
  },
  {
    id: "qwen3.5:9b",
    label: "Qwen3.5 9B",
    hint: "Better coding",
    role: "chat",
    recommended: true,
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "llama4:scout",
    label: "Llama 4 Scout",
    hint: "General purpose",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text"],
  },
  {
    id: "qwen2.5:14b",
    label: "Qwen2.5 14B",
    hint: "Larger Qwen",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "qwen2.5-coder:14b",
    label: "Qwen2.5 Coder 14B",
    hint: "Coding specialist",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "mistral-nemo",
    label: "Mistral Nemo",
    hint: "12B-class general",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text"],
  },
  {
    id: "llava:13b",
    label: "LLaVA 13B",
    hint: "Vision-language",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "vision"],
  },
  {
    id: "gemma2:9b",
    label: "Gemma 2 9B",
    hint: "Google mid",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text"],
  },
  {
    id: "command-r",
    label: "Command R",
    hint: "Cohere RAG-friendly",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text"],
  },

  // Smart (~24–32GB)
  {
    id: "gemma2:27b",
    label: "Gemma 2 27B",
    hint: "Large Gemma",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text"],
  },
  {
    id: "qwen3.5:27b",
    label: "Qwen3.5 27B",
    hint: "Best local quality",
    role: "chat",
    recommended: true,
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "qwen2.5:32b",
    label: "Qwen2.5 32B",
    hint: "Large Qwen",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "qwen2.5-coder:32b",
    label: "Qwen2.5 Coder 32B",
    hint: "Large coder",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "deepseek-r1:32b",
    label: "DeepSeek R1 32B",
    hint: "Large reasoning",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "reasoning"],
  },
  {
    id: "mixtral:8x7b",
    label: "Mixtral 8x7B",
    hint: "MoE general",
    role: "chat",
    ramGb: 26,
    tier: "smart",
    modalities: ["text"],
  },
  {
    id: "command-r-plus",
    label: "Command R+",
    hint: "Cohere large",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text"],
  },
  {
    id: "mistral-small:24b",
    label: "Mistral Small 24B",
    hint: "Mistral mid-large",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text"],
  },
  {
    id: "llama3.1:70b",
    label: "Llama 3.1 70B",
    hint: "Needs ~40GB+; listed for reference",
    role: "chat",
    ramGb: 40,
    tier: "smart",
    modalities: ["text"],
  },
  {
    id: "qwen2.5:72b",
    label: "Qwen2.5 72B",
    hint: "Needs ~48GB+; listed for reference",
    role: "chat",
    ramGb: 48,
    tier: "smart",
    modalities: ["text", "code"],
  },
];

/** Vision-only short list (legacy / optional). */
export const VISION_MODELS: readonly CatalogModel[] = [
  {
    id: "qwen3-vl:4b",
    label: "Qwen3-VL 4B",
    hint: "Vision-language",
    role: "vision",
    recommended: true,
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "llava:7b",
    label: "LLaVA 7B",
    hint: "Vision-language",
    role: "vision",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
];

/** Embedding models (applied automatically — no download prompt). */
export const EMBED_MODELS: readonly CatalogModel[] = [
  {
    id: "nomic-embed-text",
    label: "nomic-embed-text",
    hint: "Default local RAG embedder",
    role: "embed",
    recommended: true,
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "bge-m3",
    label: "bge-m3",
    hint: "Multilingual + long docs",
    role: "embed",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "jina-embeddings-v4",
    label: "jina-embeddings-v4",
    hint: "High-quality embedder",
    role: "embed",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
];

/** All curated ids (for detect / not-installed). */
export const ALL_CURATED: readonly CatalogModel[] = [
  ...CHAT_MODELS,
  ...VISION_MODELS.filter((m) => !CHAT_MODELS.some((c) => c.id === m.id)),
  ...EMBED_MODELS,
];

/**
 * Sort catalog rows by RAM ascending, then label (stable pick lists).
 *
 * @param models - Catalog entries
 */
function byRamThenLabel(models: readonly CatalogModel[]): CatalogModel[] {
  return [...models].sort((a, b) => a.ramGb - b.ramGb || a.label.localeCompare(b.label));
}

/**
 * Chat models in a tier (≤10 for manual pick), ordered by RAM.
 *
 * @param tier - Speed / quality tier
 */
export function modelsForTier(tier: ModelTier): readonly CatalogModel[] {
  return byRamThenLabel(CHAT_MODELS.filter((m) => m.tier === tier)).slice(0, 10);
}

/**
 * Recommended chat model for a tier (falls back to first in tier).
 *
 * @param tier - Selected tier
 * @param totalRamGb - Prefer models that fit when RAM is known
 */
export function recommendForTier(tier: ModelTier, totalRamGb: number | null = null): CatalogModel {
  const list = modelsForTier(tier);
  const headroom = 4;
  const fits =
    totalRamGb !== null && Number.isFinite(totalRamGb)
      ? list.filter((m) => m.ramGb + headroom <= totalRamGb || m.ramGb <= totalRamGb)
      : list;
  const pool = fits.length > 0 ? fits : list;
  return pool.find((m) => m.recommended) ?? pool[pool.length - 1] ?? list[0]!;
}

/**
 * Recommend a chat model for the host RAM (comfortable headroom).
 *
 * @param totalRamGb - Detected total system RAM in GB (or null)
 */
export function recommendChatModel(totalRamGb: number | null): CatalogModel {
  const HEADROOM = 4;
  const sorted = [...CHAT_MODELS].sort((a, b) => a.ramGb - b.ramGb);
  const smallest = sorted[0]!;
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) {
    return CHAT_MODELS.find((m) => m.recommended && m.tier === "fast") ?? smallest;
  }
  const comfortable = sorted.filter(
    (m) => (m.id === smallest.id && m.ramGb <= totalRamGb) || m.ramGb + HEADROOM <= totalRamGb,
  );
  if (comfortable.length > 0) return comfortable[comfortable.length - 1]!;
  const tierOk = sorted.filter((m) => m.ramGb <= totalRamGb);
  return tierOk.length > 0 ? tierOk[tierOk.length - 1]! : smallest;
}

/**
 * Recommend vision / embed defaults.
 *
 * @param role - vision or embed
 */
export function recommendForRole(role: "vision" | "embed"): CatalogModel {
  const list = role === "vision" ? VISION_MODELS : EMBED_MODELS;
  return list.find((m) => m.recommended) ?? list[0]!;
}

/** Format modalities for a list row. */
export function formatModalities(modalities: readonly ModelModality[]): string {
  return modalities.join(" · ");
}

/** Thin cloud provider menu (non-Ollama). */
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
 * then local / self-hosted, then optional mock.
 *
 * @param options - Include Mock (create-oke Customize)
 */
export function aiProviderSelectOptions(
  options: { readonly includeMock?: boolean } = {},
): readonly AiProviderSelectOption[] {
  const local: readonly AiProviderSelectOption[] = [
    {
      value: "llama-cpp",
      label: "llama.cpp (Local)",
      hint: "Docker Hub ai/ · recommend for your RAM",
    },
    {
      value: "ollama",
      label: "Ollama (Local)",
      hint: "detect models · recommend for your RAM",
    },
    {
      value: "vllm",
      label: "vLLM (self-hosted GPU)",
      hint: "multi-user / production concurrency",
    },
    {
      value: "sglang",
      label: "SGLang (self-hosted GPU)",
      hint: "structured / agent workloads",
    },
  ];
  const cloud = CLOUD_PROVIDERS.map((p) => ({
    value: p.value,
    label: p.label,
    ...(p.hint !== undefined ? { hint: p.hint } : {}),
  }));
  const mock: readonly AiProviderSelectOption[] = options.includeMock
    ? [{ value: "mock", label: "Mock (dev only)", hint: "no network" }]
    : [];
  return [...cloud, ...local, ...mock];
}

/**
 * Protocol driver for an AI Provider menu id.
 *
 * @param provider - Menu value
 */
export function aiDriverForMenuProvider(provider: string): string {
  if (provider === "mock") return "mock";
  if (
    provider === "llama-cpp" ||
    provider === "ollama" ||
    provider === "vllm" ||
    provider === "sglang"
  ) {
    return "openai-compatible";
  }
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

/**
 * Curated Docker Hub `ai/` chat models for llama.cpp (`LLAMA_ARG_DOCKER_REPO`).
 * Ids omit the `ai/` org prefix (llama.cpp default). ≥10 per tier; manual pick
 * shows up to 20. HF-origin weights are only listed when published under
 * Docker Hub [`ai/`](https://hub.docker.com/u/ai) (recipe cannot load raw HF ids).
 */
export const LLAMA_CPP_CHAT_MODELS: readonly CatalogModel[] = [
  // Ultra Fast (~1–2GB)
  {
    id: "smollm2",
    label: "SmolLM2",
    hint: "Lightest",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "smollm2:135M-Q4_K_M",
    label: "SmolLM2 135M",
    hint: "Tiny smoke test",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "functiongemma",
    label: "FunctionGemma 270M",
    hint: "Tool calling",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "gemma3:270m",
    label: "Gemma 3 270M",
    hint: "Google tiny",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "granite-4.0-h-nano:350M-Q8_0",
    label: "Granite 4.0 H Nano 350M",
    hint: "IBM tiny",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "qwen3:0.6B-Q4_K_M",
    label: "Qwen3 0.6B",
    hint: "Small coding",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "smolvlm:500M-Q8_0",
    label: "SmolVLM 500M",
    hint: "Tiny vision",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "vision"],
  },
  {
    id: "llama3.2:1B-Q4_0",
    label: "Llama 3.2 1B",
    hint: "Meta tiny",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "granite-4.0-h-nano",
    label: "Granite 4.0 H Nano 1B",
    hint: "IBM nano",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "qwen2.5:0.5B-F16",
    label: "Qwen2.5 0.5B",
    hint: "Small coding",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "smollm2:360M-Q4_K_M",
    label: "SmolLM2 360M",
    hint: "Small instruct",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "smollm2:135M-Q4_0",
    label: "SmolLM2 135M Q4_0",
    hint: "Tiny Q4_0",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "gemma3:270m-q4_K_M",
    label: "Gemma 3 270M Q4",
    hint: "Google tiny Q4",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "functiongemma:q4_K_M",
    label: "FunctionGemma Q4",
    hint: "Tool calling Q4",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3:0.6B-Q4_0",
    label: "Qwen3 0.6B Q4_0",
    hint: "Small coding",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "llama3.2:1B-Q8_0",
    label: "Llama 3.2 1B Q8",
    hint: "Meta tiny Q8",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "granite-4.0-nano:350M-BF16",
    label: "Granite 4.0 Nano 350M",
    hint: "IBM nano",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  {
    id: "smolvlm",
    label: "SmolVLM",
    hint: "Tiny vision default",
    role: "chat",
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "vision"],
  },
  {
    id: "granite3.3:2b",
    label: "Granite 3.3 2B",
    hint: "Default · IBM 2B",
    role: "chat",
    recommended: true,
    ramGb: 2,
    tier: "ultra-fast",
    modalities: ["text", "code"],
  },
  {
    id: "gemma3:270m-q8_0",
    label: "Gemma 3 270M Q8",
    hint: "Google tiny Q8",
    role: "chat",
    ramGb: 1,
    tier: "ultra-fast",
    modalities: ["text"],
  },
  // Fast (~4–8GB) — Gemma 4 · Qwen near the top
  {
    id: "llama3.2",
    label: "Llama 3.2 3B",
    hint: "Balanced local chat",
    role: "chat",
    recommended: true,
    ramGb: 4,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "gemma4:e2b-q4_K_M",
    label: "Gemma 4 E2B",
    hint: "Popular · multimodal",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "qwen3:4B-UD-Q4_K_XL",
    label: "Qwen3 4B",
    hint: "Popular · coding · agents",
    role: "chat",
    ramGb: 6,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "qwen2.5:3B-Q4_K_M",
    label: "Qwen2.5 3B",
    hint: "Coding",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "gemma3:4b",
    label: "Gemma 3 4B",
    hint: "Reasoning",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "reasoning"],
  },
  {
    id: "gemma3n:e2b",
    label: "Gemma 3n E2B",
    hint: "On-device multimodal",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "qwen3-vl:2B-UD-Q4_K_XL",
    label: "Qwen3-VL 2B",
    hint: "Vision",
    role: "chat",
    ramGb: 6,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "smollm3",
    label: "SmolLM3",
    hint: "On-device chat",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "ministral3:3B-Q4_K_M",
    label: "Ministral 3B",
    hint: "Mistral small",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "nemotron-3-nano:4b",
    label: "Nemotron 3 Nano 4B",
    hint: "NVIDIA nano",
    role: "chat",
    ramGb: 6,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "granite-4.0-micro",
    label: "Granite 4.0 Micro 3B",
    hint: "IBM micro",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "granite4:micro",
    label: "Granite 4 Micro",
    hint: "IBM micro Q4",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "moondream2",
    label: "Moondream2 1.5B",
    hint: "Vision",
    role: "chat",
    ramGb: 6,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "medgemma:4b",
    label: "MedGemma 4B",
    hint: "Medical",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "granite4.1:3b",
    label: "Granite 4.1 3B",
    hint: "IBM 3B",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  {
    id: "llama3.2:3B-Q4_K_M",
    label: "Llama 3.2 3B Q4",
    hint: "Meta 3B Q4",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "gemma4:e2b",
    label: "Gemma 4 E2B default",
    hint: "Popular · multimodal",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "vision"],
  },
  {
    id: "gemma3:4b-q4_K_M",
    label: "Gemma 3 4B Q4",
    hint: "Reasoning Q4",
    role: "chat",
    ramGb: 8,
    tier: "fast",
    modalities: ["text", "reasoning"],
  },
  {
    id: "smollm3:Q4_K_M",
    label: "SmolLM3 Q4",
    hint: "On-device Q4",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text"],
  },
  {
    id: "granite3.3:2b-q4_K_M",
    label: "Granite 3.3 2B Q4",
    hint: "IBM 2B Q4",
    role: "chat",
    ramGb: 4,
    tier: "fast",
    modalities: ["text", "code"],
  },
  // Balanced (~8–16GB) — Gemma 4 E4B · Qwen near the top
  {
    id: "qwen3:8B-Q4_K_M",
    label: "Qwen3 8B",
    hint: "Popular · coding · agents",
    role: "chat",
    recommended: true,
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "gemma4:e4b",
    label: "Gemma 4 E4B",
    hint: "Popular · multimodal",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "vision", "reasoning"],
  },
  {
    id: "qwen2.5:7B-Q4_K_M",
    label: "Qwen2.5 7B",
    hint: "Coding",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3-vl:8B",
    label: "Qwen3-VL 8B",
    hint: "Vision",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "vision", "code"],
  },
  {
    id: "llama3.1:8B-Q4_K_M",
    label: "Llama 3.1 8B",
    hint: "Meta general",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text"],
  },
  {
    id: "gemma3n:e4b",
    label: "Gemma 3n E4B",
    hint: "On-device multimodal",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "vision"],
  },
  {
    id: "mistral",
    label: "Mistral 7B",
    hint: "General + code",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "deepseek-r1-distill-llama:8B-Q4_K_M",
    label: "DeepSeek R1 8B",
    hint: "Reasoning distill",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "reasoning"],
  },
  {
    id: "mistral-nemo",
    label: "Mistral Nemo 12B",
    hint: "General",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "ministral3:8B-Q4_K_M",
    label: "Ministral 8B",
    hint: "Mistral instruct",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "granite-4.0-h-tiny",
    label: "Granite 4.0 H Tiny 7B",
    hint: "IBM tiny",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "ministral-3:8b-instruct",
    label: "Ministral 3 8B Instruct",
    hint: "Instruct",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "granite3.3:8b",
    label: "Granite 3.3 8B",
    hint: "IBM 8B",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "granite4.1:8b",
    label: "Granite 4.1 8B",
    hint: "IBM 8B",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3:8B-Q4_0",
    label: "Qwen3 8B Q4_0",
    hint: "Coding Q4_0",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "gemma4:e4b-q4_K_M",
    label: "Gemma 4 E4B Q4",
    hint: "Popular · multimodal Q4",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "vision", "reasoning"],
  },
  {
    id: "ministral-3:8b-reasoning",
    label: "Ministral 3 8B Reasoning",
    hint: "Reasoning",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "reasoning", "code"],
  },
  {
    id: "llama3.1",
    label: "Llama 3.1 8B",
    hint: "Meta default",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text"],
  },
  {
    id: "qwen2.5",
    label: "Qwen2.5 7B",
    hint: "Coding default",
    role: "chat",
    ramGb: 12,
    tier: "balanced",
    modalities: ["text", "code"],
  },
  {
    id: "gemma3n",
    label: "Gemma 3n",
    hint: "On-device default",
    role: "chat",
    ramGb: 16,
    tier: "balanced",
    modalities: ["text", "vision"],
  },
  // Smart (~24–32GB) — Gemma 4 31B · Qwen family near the top
  {
    id: "phi4",
    label: "Phi-4 14B",
    hint: "Reasoning",
    role: "chat",
    recommended: true,
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "reasoning", "code"],
  },
  {
    id: "gemma4:31b",
    label: "Gemma 4 31B",
    hint: "Popular · large multimodal",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "vision", "reasoning"],
  },
  {
    id: "qwen3.5:27b",
    label: "Qwen3.5 27B",
    hint: "Popular · general · coding",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3:30B-A3B-Q4_K_M",
    label: "Qwen3 30B-A3B",
    hint: "MoE · coding",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3-coder:30B",
    label: "Qwen3-Coder 30B",
    hint: "Coding agent",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3-vl:32B-UD-Q4_K_XL",
    label: "Qwen3-VL 32B",
    hint: "Vision",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "vision", "code"],
  },
  {
    id: "gemma3:27b",
    label: "Gemma 3 27B",
    hint: "Large reasoning",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "reasoning"],
  },
  {
    id: "qwq:32B-Q4_K_M",
    label: "QwQ 32B",
    hint: "Reasoning",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "reasoning"],
  },
  {
    id: "gpt-oss:20b",
    label: "GPT-OSS 20B",
    hint: "Open weights",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "reasoning"],
  },
  {
    id: "magistral-small-3.2",
    label: "Magistral Small 24B",
    hint: "Reasoning",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "reasoning"],
  },
  {
    id: "ministral3:14B",
    label: "Ministral 14B",
    hint: "Mistral mid",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "nemotron-3-nano:30b-a3b",
    label: "Nemotron 3 Nano 30B-A3B",
    hint: "NVIDIA MoE",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "devstral-small-2",
    label: "Devstral Small 2",
    hint: "Coding",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "medgemma:27b-text",
    label: "MedGemma 27B Text",
    hint: "Medical",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text"],
  },
  {
    id: "gemma4:26b-a4b-q4_K_M",
    label: "Gemma 4 26B-A4B",
    hint: "Popular · MoE multimodal",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "vision", "reasoning"],
  },
  {
    id: "glm-4.7-flash",
    label: "GLM-4.7 Flash",
    hint: "MoE flash",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "granite4.1:30b",
    label: "Granite 4.1 30B",
    hint: "IBM 30B",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "deepcoder-preview",
    label: "DeepCoder Preview 14B",
    hint: "Coding",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "qwen3:14B-Q6_K",
    label: "Qwen3 14B",
    hint: "Coding mid",
    role: "chat",
    ramGb: 24,
    tier: "smart",
    modalities: ["text", "code"],
  },
  {
    id: "nemotron3",
    label: "Nemotron 3 30B",
    hint: "NVIDIA",
    role: "chat",
    ramGb: 32,
    tier: "smart",
    modalities: ["text", "code"],
  },
];

/**
 * llama.cpp chat models in a tier (manual pick shows up to 20), ordered by RAM.
 *
 * @param tier - Speed / quality tier
 */
export function llamaCppModelsForTier(tier: ModelTier): readonly CatalogModel[] {
  return byRamThenLabel(LLAMA_CPP_CHAT_MODELS.filter((m) => m.tier === tier)).slice(0, 20);
}

/**
 * Recommended Docker Hub `ai/` model for a tier (RAM-aware).
 *
 * @param tier - Selected tier
 * @param totalRamGb - Prefer models that fit when RAM is known
 */
export function recommendLlamaCppForTier(
  tier: ModelTier,
  totalRamGb: number | null = null,
): CatalogModel {
  const list = llamaCppModelsForTier(tier);
  const headroom = 4;
  const fits =
    totalRamGb !== null && Number.isFinite(totalRamGb)
      ? list.filter((m) => m.ramGb + headroom <= totalRamGb || m.ramGb <= totalRamGb)
      : list;
  const pool = fits.length > 0 ? fits : list;
  return pool.find((m) => m.recommended) ?? pool[pool.length - 1] ?? list[0]!;
}
