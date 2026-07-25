/**
 * `openai-compatible` AI driver — thin HTTP client for OpenAI-shaped APIs.
 *
 * Covers OpenAI, vLLM, Groq, Together, LM Studio, and most self-hosted
 * servers (unified-theory §16). Injectable `fetch` for tests. Never a
 * production default — prod must declare.
 */

import type {
  AiCompleteOptions,
  AiCompleteResult,
  AiDriver,
  AiEmbedOptions,
  AiEmbedResult,
  AiModelClient,
  AiOpenOptions,
} from "./ai-types.ts";

const DEFAULT_BASE = "https://api.openai.com/v1";

/**
 * Open an OpenAI-compatible chat / embeddings client.
 *
 * @param options - API key / model / base URL / injectable fetch
 */
export async function openOpenaiCompatible(
  options: AiOpenOptions = {},
): Promise<AiModelClient> {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "openai-compatible: apiKey is required (or OPENAI_API_KEY)",
    );
  }
  const model = options.model ?? "gpt-4o-mini";
  const baseUrl = (options.baseUrl ?? DEFAULT_BASE).replace(/\/$/, "");
  const fetchFn = options.fetch ?? globalThis.fetch;

  return {
    driverId: "openai-compatible",
    model,
    async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
      const resolvedModel = opts.model ?? model;
      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: opts.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.name !== undefined ? { name: m.name } : {}),
        })),
      };
      if (opts.temperature !== undefined) body.temperature = opts.temperature;
      if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
      if (opts.responseFormat !== undefined) {
        body.response_format = opts.responseFormat;
      }

      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });
      const raw = (await res.json().catch(() => ({}))) as OpenAiChatResponse;
      if (!res.ok) {
        const msg =
          raw.error?.message ?? `openai-compatible HTTP ${res.status}`;
        throw new Error(`openai-compatible: ${msg}`);
      }
      const text = raw.choices?.[0]?.message?.content ?? "";
      return {
        text,
        raw,
        model: raw.model ?? resolvedModel,
        driverId: "openai-compatible",
        usage: {
          inputTokens: raw.usage?.prompt_tokens,
          outputTokens: raw.usage?.completion_tokens,
        },
      };
    },
    async embed(opts: AiEmbedOptions): Promise<AiEmbedResult> {
      const resolvedModel = opts.model ?? model;
      const input = opts.input;
      const res = await fetchFn(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ model: resolvedModel, input }),
      });
      const raw = (await res.json().catch(() => ({}))) as OpenAiEmbedResponse;
      if (!res.ok) {
        const msg =
          raw.error?.message ?? `openai-compatible embed HTTP ${res.status}`;
        throw new Error(`openai-compatible: ${msg}`);
      }
      const vectors = (raw.data ?? [])
        .slice()
        .sort((a, b) => (a.index ?? 0) - (b.index ?? 0))
        .map((d) => d.embedding ?? []);
      return {
        vectors,
        model: raw.model ?? resolvedModel,
        driverId: "openai-compatible",
      };
    },
  };
}

/** Protocol-named openai-compatible driver. */
export const openaiCompatibleAiDriver: AiDriver = {
  id: "openai-compatible",
  open: openOpenaiCompatible,
};

interface OpenAiChatResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: { readonly content?: string | null };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
  readonly error?: { readonly message?: string };
}

interface OpenAiEmbedResponse {
  readonly model?: string;
  readonly data?: readonly {
    readonly embedding?: readonly number[];
    readonly index?: number;
  }[];
  readonly error?: { readonly message?: string };
}
