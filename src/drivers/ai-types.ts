/**
 * Protocol-named AI model driver contracts.
 *
 * Driver ids: `mock` · `anthropic` · `openai-compatible` · `bedrock` · `vertex` · `ollama`.
 * Dev default is `mock`. There is **no** production default — prod must declare.
 */

/** Protocol ids for AI model drivers. */
export type AiDriverId =
  | "mock"
  | "anthropic"
  | "openai-compatible"
  | "bedrock"
  | "vertex"
  | "ollama";

/** One chat / completion turn. */
export interface AiMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
}

/** Options for a model completion. */
export interface AiCompleteOptions {
  readonly messages: readonly AiMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Structured output hint (JSON schema or name). */
  readonly responseFormat?: unknown;
}

/** Result of a model completion. */
export interface AiCompleteResult {
  readonly text: string;
  readonly raw?: unknown;
  readonly model: string;
  readonly driverId: AiDriverId;
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cost?: number;
  };
}

/** Embedding request. */
export interface AiEmbedOptions {
  readonly input: string | readonly string[];
  readonly model?: string;
}

/** Embedding result. */
export interface AiEmbedResult {
  readonly vectors: readonly (readonly number[])[];
  readonly model: string;
  readonly driverId: AiDriverId;
}

/** Opened model client. */
export interface AiModelClient {
  readonly driverId: AiDriverId;
  readonly model: string;
  complete(options: AiCompleteOptions): Promise<AiCompleteResult>;
  embed?(options: AiEmbedOptions): Promise<AiEmbedResult>;
  close?(): Promise<void>;
}

/** Options when opening a model driver. */
export interface AiOpenOptions {
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /** Mock canned responses keyed by prompt name or substring. */
  readonly mockResponses?: Readonly<Record<string, unknown>>;
  readonly fetch?: typeof globalThis.fetch;
}

/** AI model driver factory. */
export interface AiDriver {
  readonly id: AiDriverId;
  open(options?: AiOpenOptions): Promise<AiModelClient>;
}
