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

/** One curated Ollama model entry. */
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
 * Chat models in a tier (≤10 for manual pick).
 *
 * @param tier - Speed / quality tier
 */
export function modelsForTier(tier: ModelTier): readonly CatalogModel[] {
  return CHAT_MODELS.filter((m) => m.tier === tier).slice(0, 10);
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
export const CLOUD_PROVIDERS = [
  {
    value: "openai",
    label: "OpenAI",
    driver: "openai-compatible" as const,
    baseUrl: "https://api.openai.com/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    value: "anthropic",
    label: "Anthropic",
    driver: "anthropic" as const,
    baseUrl: undefined,
    apiKeyEnv: "ANTHROPIC_API_KEY",
  },
  {
    value: "gemini",
    label: "Gemini",
    driver: "openai-compatible" as const,
    baseUrl: undefined,
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    driver: "openai-compatible" as const,
    baseUrl: "http://127.0.0.1:1234/v1",
    apiKeyEnv: undefined,
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    driver: "openai-compatible" as const,
    baseUrl: "https://openrouter.ai/api/v1",
    apiKeyEnv: "OPENAI_API_KEY",
  },
  {
    value: "custom",
    label: "Custom OpenAI Compatible",
    driver: "openai-compatible" as const,
    baseUrl: undefined,
    apiKeyEnv: "OPENAI_API_KEY",
  },
] as const;

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
      id: "openai/gpt-4o-mini",
      label: "GPT-4o mini",
      hint: "via OpenRouter",
      recommended: true,
    },
    { id: "openai/gpt-4.1", label: "GPT-4.1", hint: "via OpenRouter" },
    { id: "openai/o4-mini", label: "o4-mini", hint: "via OpenRouter" },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "via OpenRouter" },
    { id: "anthropic/claude-opus-4", label: "Claude Opus 4", hint: "via OpenRouter" },
    { id: "anthropic/claude-haiku-4", label: "Claude Haiku 4", hint: "via OpenRouter" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "via OpenRouter" },
    { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "via OpenRouter" },
    { id: "meta-llama/llama-4-scout", label: "Llama 4 Scout", hint: "via OpenRouter" },
    { id: "deepseek/deepseek-r1", label: "DeepSeek R1", hint: "via OpenRouter" },
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
