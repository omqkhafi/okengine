/**
 * Verified OpenAI-compatible provider registry for {@link ai.model}.
 *
 * Known names resolve `baseUrl` automatically. Explicit `baseUrl` always wins.
 * Unknown names require an explicit `baseUrl` (fail loud). Limited-compatibility
 * entries carry caveat text surfaced at declare/extract time.
 */

/** Registry status — 1 = verified OpenAI-compat; 2 = limited compatibility. */
export type AiProviderTier = 1 | 2;

/** One verified OpenAI-compatible provider. */
export interface AiProviderEntry {
  readonly baseUrl: string;
  readonly tier: AiProviderTier;
  /** Honest limitation text for limited-compatibility providers (tool-calling / eval-only). */
  readonly caveat?: string;
}

/** Drivers that own their own base URL — never inject openai-compat registry. */
export const AI_NATIVE_DRIVER_IDS = new Set(["anthropic", "mock"]);

/**
 * Provider labels that are not OpenAI-compat cloud names and do not require
 * `baseUrl` (native/local/mock bindings; driver defaults apply).
 */
export const AI_PROVIDER_BASEURL_EXEMPT = new Set([
  "mock",
  "local",
  "openai-compatible",
]);

const ANTHROPIC_OPENAI_COMPAT_CAVEAT =
  "Anthropic's OpenAI-compatible endpoint (https://api.anthropic.com/v1) is for testing/evaluation only — Anthropic recommends the native Claude API for production. Caveats: tools[].function.strict is ignored (no schema guarantee), n must be 1, no embeddings on this surface. Prefer driverId: \"anthropic\" for production Anthropic usage.";

const GOOGLE_OPENAI_COMPAT_CAVEAT =
  "Google's OpenAI-compatible endpoint does not follow full OpenAI tool/parameter JSON Schema fidelity (OpenAPI-shaped params; complex schemas with $ref / anyOf / additionalProperties / $schema commonly fail). Agents that call Flows as tools can misbehave silently — do not treat this as a verified provider for tool-calling-dependent production.";

const GOOGLE_ENTRY: AiProviderEntry = {
  baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai",
  tier: 2,
  caveat: GOOGLE_OPENAI_COMPAT_CAVEAT,
};

/**
 * Verified OpenAI-compatible providers — URLs locked from official sources.
 * Cloudflare is omitted (account-scoped URL; require explicit baseUrl).
 */
export const AI_OPENAI_COMPAT_PROVIDERS: Readonly<Record<string, AiProviderEntry>> = {
  openai: { baseUrl: "https://api.openai.com/v1", tier: 1 },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", tier: 1 },
  groq: { baseUrl: "https://api.groq.com/openai/v1", tier: 1 },
  together: { baseUrl: "https://api.together.ai/v1", tier: 1 },
  deepinfra: { baseUrl: "https://api.deepinfra.com/v1/openai", tier: 1 },
  meta: { baseUrl: "https://api.meta.ai/v1", tier: 1 },
  xai: { baseUrl: "https://api.x.ai/v1", tier: 1 },
  mistral: { baseUrl: "https://api.mistral.ai/v1", tier: 1 },
  deepseek: { baseUrl: "https://api.deepseek.com", tier: 1 },
  vercel: { baseUrl: "https://ai-gateway.vercel.sh/v1", tier: 1 },
  anthropic: {
    baseUrl: "https://api.anthropic.com/v1",
    tier: 2,
    caveat: ANTHROPIC_OPENAI_COMPAT_CAVEAT,
  },
  google: GOOGLE_ENTRY,
  /** CLI catalog alias for {@link GOOGLE_ENTRY}. */
  gemini: GOOGLE_ENTRY,
};

/**
 * Look up a verified OpenAI-compatible provider by name.
 *
 * @param provider - Provider name from `ai.model({ provider })`
 */
export function getAiProviderEntry(provider: string): AiProviderEntry | undefined {
  return AI_OPENAI_COMPAT_PROVIDERS[provider];
}

/**
 * Error when `provider` is set, not in the registry, and `baseUrl` is omitted.
 *
 * @param provider - Unknown provider name
 */
export function unknownAiProviderBaseUrlError(provider: string): Error {
  return new Error(
    `ai.model: unknown provider "${provider}" requires an explicit baseUrl ` +
      `(known OpenAI-compatible providers: ${Object.keys(AI_OPENAI_COMPAT_PROVIDERS)
        .filter((k) => k !== "gemini")
        .sort()
        .join(", ")}; ` +
      `gemini is an alias of google). Cloudflare and other account-scoped endpoints always need baseUrl.`,
  );
}

/** Inputs for {@link resolveAiModelBaseUrl}. */
export interface ResolveAiModelBaseUrlInput {
  readonly provider?: string;
  readonly baseUrl?: string;
  readonly driverId?: string;
}

/** Result of baseUrl resolution for one model binding. */
export interface ResolveAiModelBaseUrlResult {
  readonly baseUrl?: string;
  /** Limited-compatibility caveat to surface at declare/extract time (when auto-resolved). */
  readonly tier2Caveat?: string;
  /** Provider name that produced the limited-compatibility caveat. */
  readonly tier2Provider?: string;
}

/**
 * Resolve `baseUrl` for an `ai.model` declaration.
 *
 * Explicit `baseUrl` always wins. Native drivers skip the openai-compat
 * registry. Known providers auto-fill; unknown providers without `baseUrl`
 * throw.
 *
 * @param input - Provider / baseUrl / driverId from AiModelOptions
 */
export function resolveAiModelBaseUrl(
  input: ResolveAiModelBaseUrlInput,
): ResolveAiModelBaseUrlResult {
  if (input.baseUrl !== undefined) {
    return { baseUrl: input.baseUrl };
  }

  if (input.driverId !== undefined && AI_NATIVE_DRIVER_IDS.has(input.driverId)) {
    return {};
  }

  const provider = input.provider;
  if (provider === undefined) {
    return {};
  }

  const entry = getAiProviderEntry(provider);
  if (!entry) {
    if (AI_PROVIDER_BASEURL_EXEMPT.has(provider)) {
      return {};
    }
    throw unknownAiProviderBaseUrlError(provider);
  }

  if (entry.tier === 2 && entry.caveat !== undefined) {
    return {
      baseUrl: entry.baseUrl,
      tier2Caveat: entry.caveat,
      tier2Provider: provider,
    };
  }

  return { baseUrl: entry.baseUrl };
}

/**
 * Format a limited-compatibility caveat for declare-time / extract-time
 * `console.warn`.
 *
 * @param provider - Provider name
 * @param caveat - Registry caveat text
 * @param prefix - Log prefix (`ai.model` or `[oke extract] warn`)
 */
export function formatAiProviderTier2Warn(
  provider: string,
  caveat: string,
  prefix: "ai.model" | "[oke extract] warn",
): string {
  return `${prefix}: provider "${provider}" (limited OpenAI-compatible): ${caveat}`;
}
