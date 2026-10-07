/**
 * Verified decision hosts. Anything else is `driverId` + `baseUrl` + `capabilities`.
 * Codecs stay out of this module so the edge graph does not load them.
 */

/** Wire a decider speaks. */
export type DeciderProtocol = "systemone" | "openai-decisions";

/** How a certificate binds to a model id. */
export type DeciderPinning = "dated" | "alias";

/** What one decider can answer. Numeric limits apply only when present. */
export interface DeciderCapabilities {
  readonly boolean: boolean;
  readonly choice: boolean;
  readonly score: boolean;
  readonly refusal: boolean;
  readonly maxChoices?: number;
  readonly minLevels?: number;
  readonly maxLevels?: number;
  readonly maxContext?: number;
}

/** One verified host. */
export interface DeciderPreset {
  readonly protocol: DeciderProtocol;
  readonly baseUrl: string;
  readonly secret: string;
  readonly pinning: DeciderPinning;
  readonly capabilities: DeciderCapabilities;
}

/** Literal capabilities for the OpenRouter preset. */
type OpenRouterPreset = {
  readonly protocol: "systemone";
  readonly baseUrl: "https://openrouter.ai/api/alpha/decisions";
  readonly secret: "OPENROUTER_API_KEY";
  readonly pinning: "dated";
  readonly capabilities: {
    readonly boolean: true;
    readonly choice: true;
    readonly score: true;
    readonly refusal: false;
  };
};

/** Literal capabilities for the OpenAI preset. */
type OpenAIPreset = {
  readonly protocol: "openai-decisions";
  readonly baseUrl: "https://api.openai.com/v1/decisions";
  readonly secret: "OPENAI_API_KEY";
  readonly pinning: "alias";
  readonly capabilities: {
    readonly boolean: true;
    readonly choice: true;
    readonly score: true;
    readonly refusal: true;
  };
};

/** OpenRouter System One and OpenAI Decisions. No other host is filled in. */
export const DECIDER_PRESETS: {
  readonly openrouter: OpenRouterPreset;
  readonly openai: OpenAIPreset;
} = {
  openrouter: {
    protocol: "systemone",
    baseUrl: "https://openrouter.ai/api/alpha/decisions",
    secret: "OPENROUTER_API_KEY",
    pinning: "dated",
    capabilities: { boolean: true, choice: true, score: true, refusal: false },
  },
  openai: {
    protocol: "openai-decisions",
    baseUrl: "https://api.openai.com/v1/decisions",
    secret: "OPENAI_API_KEY",
    pinning: "alias",
    capabilities: { boolean: true, choice: true, score: true, refusal: true },
  },
};

/** Preset provider id. */
export type DeciderPresetName = keyof typeof DECIDER_PRESETS;

/** Alias certificates expire this long after certify. */
export const ALIAS_CERTIFICATE_MS: number = 30 * 24 * 60 * 60 * 1000;

/**
 * Whether `provider` is a shipped preset.
 *
 * @param provider - Author provider id
 */
export function isDeciderPreset(provider: string): provider is DeciderPresetName {
  return Object.prototype.hasOwnProperty.call(DECIDER_PRESETS, provider);
}

/** Fields shared by a preset and a custom host. */
export interface ResolvedDecider {
  readonly protocol: DeciderProtocol;
  readonly baseUrl: string;
  readonly model: string;
  readonly secret: string;
  readonly pinning: DeciderPinning;
  readonly capabilities: DeciderCapabilities;
  readonly provider?: string;
  readonly region?: string;
  readonly regionStatus?: "declared";
  readonly zdr?: boolean;
  readonly zdrStatus?: "declared";
  readonly timeout?: number | string;
  readonly concurrency?: number;
}

/**
 * Fill a preset, or require the custom host fields.
 * Region and ZDR are the app's declaration. Neither preset publishes a verified value.
 *
 * @param name - Decider name, for the error
 * @param options - Author options
 */
export function resolveDecider(
  name: string,
  options: {
    readonly provider?: string;
    readonly driverId?: string;
    readonly baseUrl?: string;
    readonly model?: string;
    readonly secret?: string;
    readonly capabilities?: DeciderCapabilities;
    readonly region?: string;
    readonly zdr?: boolean;
    readonly timeout?: number | string;
    readonly concurrency?: number;
  },
): ResolvedDecider {
  if (!options.model) throw new TypeError(`ai.decider("${name}"): model is required`);
  const declared = {
    ...(options.region !== undefined
      ? { region: options.region, regionStatus: "declared" as const }
      : {}),
    ...(options.zdr !== undefined ? { zdr: options.zdr, zdrStatus: "declared" as const } : {}),
    ...(options.timeout !== undefined ? { timeout: options.timeout } : {}),
    ...(options.concurrency !== undefined ? { concurrency: options.concurrency } : {}),
  };
  if (options.provider && isDeciderPreset(options.provider)) {
    const preset = DECIDER_PRESETS[options.provider];
    return {
      protocol: preset.protocol,
      baseUrl: preset.baseUrl,
      model: options.model,
      secret: options.secret ?? preset.secret,
      pinning: preset.pinning,
      capabilities: preset.capabilities,
      provider: options.provider,
      ...declared,
    };
  }
  if (options.driverId !== "systemone" && options.driverId !== "openai-decisions") {
    throw new TypeError(
      `ai.decider("${name}"): provider "${options.provider ?? ""}" needs driverId "systemone" or "openai-decisions", baseUrl, and capabilities`,
    );
  }
  if (!options.baseUrl) {
    throw new TypeError(`ai.decider("${name}"): baseUrl is required`);
  }
  if (!options.secret) {
    throw new TypeError(`ai.decider("${name}"): secret is required`);
  }
  if (!options.capabilities) {
    throw new TypeError(`ai.decider("${name}"): capabilities are required`);
  }
  return {
    protocol: options.driverId,
    baseUrl: options.baseUrl,
    model: options.model,
    secret: options.secret,
    pinning: options.driverId === "openai-decisions" ? "alias" : "dated",
    capabilities: options.capabilities,
    ...(options.provider !== undefined ? { provider: options.provider } : {}),
    ...declared,
  };
}
