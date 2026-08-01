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

/** Tool definition offered to a model (Flow-backed at the fx layer). */
export interface AiToolDef {
  readonly name: string;
  readonly description?: string;
  /** JSON-schema-like parameters object. */
  readonly parameters?: unknown;
}

/** One model-initiated tool invocation. */
export interface AiToolCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: unknown;
}

/** One chat / completion turn. */
export interface AiMessage {
  readonly role: "system" | "user" | "assistant" | "tool";
  readonly content: string;
  readonly name?: string;
  /** When role is `tool`, the id of the tool call this message answers. */
  readonly toolCallId?: string;
  /** When role is `assistant`, optional tool calls the model requested. */
  readonly toolCalls?: readonly AiToolCall[];
}

/** Options for a model completion (or stream start). */
export interface AiCompleteOptions {
  readonly messages: readonly AiMessage[];
  readonly model?: string;
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Structured output hint (JSON schema or name). */
  readonly responseFormat?: unknown;
  /** Tools the model may call (OpenAI-shaped; drivers map). */
  readonly tools?: readonly AiToolDef[];
  /** Ambient / local abort — cooperative cancellation for complete + stream. */
  readonly signal?: AbortSignal;
}

/** Result of a model completion. */
export interface AiCompleteResult {
  readonly text: string;
  readonly raw?: unknown;
  readonly model: string;
  readonly driverId: AiDriverId;
  readonly toolCalls?: readonly AiToolCall[];
  readonly usage?: {
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly cost?: number;
  };
}

/** One streamed token / delta from a model. */
export interface AiStreamChunk {
  readonly text: string;
  readonly done?: boolean;
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
  /**
   * Stream tokens. Optional — callers fail loud when missing (no stub echo).
   *
   * @param options - Same as complete, plus optional signal
   */
  stream?(options: AiCompleteOptions): AsyncIterable<AiStreamChunk>;
  embed?(options: AiEmbedOptions): Promise<AiEmbedResult>;
  close?(): Promise<void>;
}

/** Options when opening a model driver. */
export interface AiOpenOptions {
  readonly model?: string;
  readonly apiKey?: string;
  readonly baseUrl?: string;
  /**
   * Extra HTTP headers (e.g. OpenRouter `HTTP-Referer` / `X-Title`).
   * Merged into chat and embed requests; does not invent a new driver.
   */
  readonly headers?: Readonly<Record<string, string>>;
  /** Mock canned responses keyed by prompt name or substring. */
  readonly mockResponses?: Readonly<Record<string, unknown>>;
  readonly fetch?: typeof globalThis.fetch;
}

/** AI model driver factory. */
export interface AiDriver {
  readonly id: AiDriverId;
  open(options?: AiOpenOptions): Promise<AiModelClient>;
}
