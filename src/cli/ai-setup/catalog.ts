/**
 * Curated Ollama model catalog for `oke ai setup`.
 *
 * Short lists with Recommended — not the full Ollama library.
 * Tags verified against common 2026 library names; override freely.
 */

/** Role a model can fill in the wizard. */
export type CatalogRole = "chat" | "vision" | "embed";

/** One curated model entry. */
export type CatalogModel = {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly role: CatalogRole;
  readonly recommended?: boolean;
  /** Approximate RAM (GB) needed to run comfortably. */
  readonly ramGb: number;
};

/** Chat models (short list). */
export const CHAT_MODELS: readonly CatalogModel[] = [
  {
    id: "gemma4:e4b",
    label: "Gemma 4 4B",
    hint: "Fast · ≈8GB-class machine",
    role: "chat",
    recommended: true,
    ramGb: 8,
  },
  {
    id: "qwen3.5:9b",
    label: "Qwen3.5 9B",
    hint: "Better coding · ≈16GB-class",
    role: "chat",
    ramGb: 16,
  },
  {
    id: "qwen3.5:27b",
    label: "Qwen3.5 27B",
    hint: "Best local quality · ≈32GB-class",
    role: "chat",
    ramGb: 32,
  },
  {
    id: "llama4:scout",
    label: "Llama 4 Scout",
    hint: "General purpose · ≈16GB-class",
    role: "chat",
    ramGb: 16,
  },
  {
    id: "deepseek-r1:8b",
    label: "DeepSeek R1 8B",
    hint: "Strong reasoning · ≈10GB-class",
    role: "chat",
    ramGb: 10,
  },
];

/** Vision models (short list + skip handled in prompts). */
export const VISION_MODELS: readonly CatalogModel[] = [
  {
    id: "qwen3-vl:4b",
    label: "Qwen3-VL 4B",
    hint: "Vision-language",
    role: "vision",
    recommended: true,
    ramGb: 8,
  },
  {
    id: "gemma4:e4b",
    label: "Gemma Vision",
    hint: "Multimodal Gemma 4",
    role: "vision",
    ramGb: 8,
  },
];

/** Embedding models. */
export const EMBED_MODELS: readonly CatalogModel[] = [
  {
    id: "nomic-embed-text",
    label: "nomic-embed-text",
    hint: "Default local RAG embedder",
    role: "embed",
    recommended: true,
    ramGb: 1,
  },
  {
    id: "bge-m3",
    label: "bge-m3",
    hint: "Multilingual + long docs",
    role: "embed",
    ramGb: 2,
  },
  {
    id: "jina-embeddings-v4",
    label: "jina-embeddings-v4",
    hint: "High-quality embedder",
    role: "embed",
    ramGb: 2,
  },
];

/** All curated ids (for detect / not-installed). */
export const ALL_CURATED: readonly CatalogModel[] = [
  ...CHAT_MODELS,
  ...VISION_MODELS.filter((m) => !CHAT_MODELS.some((c) => c.id === m.id)),
  ...EMBED_MODELS,
];

/**
 * Recommend a chat model for the host RAM (comfortable headroom).
 *
 * Prefer {@link recommendChatForNeeds} when use-case answers are available.
 *
 * @param totalRamGb - Detected total system RAM in GB (or null)
 */
export function recommendChatModel(totalRamGb: number | null): CatalogModel {
  // Keep catalog free of recommend.ts cycles — same rules as comfortableChatModels.
  const HEADROOM = 4;
  const sorted = [...CHAT_MODELS].sort((a, b) => a.ramGb - b.ramGb);
  const smallest = sorted[0]!;
  if (totalRamGb === null || !Number.isFinite(totalRamGb)) {
    return CHAT_MODELS.find((m) => m.recommended) ?? smallest;
  }
  const comfortable = sorted.filter(
    (m) => (m.id === smallest.id && m.ramGb <= totalRamGb) || m.ramGb + HEADROOM <= totalRamGb,
  );
  if (comfortable.length > 0) return comfortable[comfortable.length - 1]!;
  // Fall back to largest that meets the machine tier (tight but runnable).
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

/** Thin cloud provider menu (non-Ollama). */
export const CLOUD_PROVIDERS = [
  {
    value: "openai",
    label: "OpenAI",
    driver: "openai-compatible" as const,
    baseUrl: "https://api.openai.com/v1",
  },
  { value: "anthropic", label: "Anthropic", driver: "anthropic" as const, baseUrl: undefined },
  {
    value: "gemini",
    label: "Gemini",
    driver: "openai-compatible" as const,
    baseUrl: undefined,
  },
  {
    value: "lmstudio",
    label: "LM Studio",
    driver: "openai-compatible" as const,
    baseUrl: "http://127.0.0.1:1234/v1",
  },
  {
    value: "openrouter",
    label: "OpenRouter",
    driver: "openai-compatible" as const,
    baseUrl: "https://openrouter.ai/api/v1",
  },
  {
    value: "custom",
    label: "Custom OpenAI Compatible",
    driver: "openai-compatible" as const,
    baseUrl: undefined,
  },
] as const;

/** Cloud chat model entry (no RAM tier). */
export type CloudModel = {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly recommended?: boolean;
};

/** Short curated chat models per cloud / openai-compatible provider. */
export const CLOUD_CHAT_MODELS: Readonly<Record<string, readonly CloudModel[]>> = {
  openai: [
    { id: "gpt-4o-mini", label: "GPT-4o mini", hint: "Fast · cheap default", recommended: true },
    { id: "gpt-4o", label: "GPT-4o", hint: "Strong general / vision" },
    { id: "gpt-4.1", label: "GPT-4.1", hint: "Latest flagship" },
    { id: "o4-mini", label: "o4-mini", hint: "Reasoning · lower cost" },
  ],
  anthropic: [
    {
      id: "claude-sonnet-4-20250514",
      label: "Claude Sonnet 4",
      hint: "Balanced default",
      recommended: true,
    },
    { id: "claude-opus-4-20250514", label: "Claude Opus 4", hint: "Highest quality" },
    { id: "claude-haiku-4-20250514", label: "Claude Haiku 4", hint: "Fast · cheap" },
  ],
  gemini: [
    {
      id: "gemini-2.5-flash",
      label: "Gemini 2.5 Flash",
      hint: "Fast default",
      recommended: true,
    },
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", hint: "Higher quality" },
  ],
  openrouter: [
    {
      id: "openai/gpt-4o-mini",
      label: "GPT-4o mini",
      hint: "via OpenRouter",
      recommended: true,
    },
    { id: "anthropic/claude-sonnet-4", label: "Claude Sonnet 4", hint: "via OpenRouter" },
    { id: "google/gemini-2.5-flash", label: "Gemini 2.5 Flash", hint: "via OpenRouter" },
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
 * Curated chat models for a cloud provider (empty → Other-only).
 *
 * @param provider - Menu provider id
 */
export function cloudChatModels(provider: string): readonly CloudModel[] {
  return CLOUD_CHAT_MODELS[provider] ?? [];
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
