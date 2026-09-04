/**
 * `openai-compatible` AI driver — thin HTTP client for OpenAI-shaped APIs.
 *
 * One protocol driver for OpenAI, Groq, Together, OpenRouter, vLLM, LM Studio,
 * Ollama `/v1`, and other chat/completions endpoints. Configure via
 * `baseUrl` + `apiKey` + `model` (+ optional `headers`). Native Ollama stays
 * on the separate `ollama` driver. Injectable `fetch` for tests. Never a
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
  AiStreamChunk,
  AiToolCall,
} from "./ai-types.ts";

/** Default OpenAI cloud base — apiKey is required for this origin. */
export const OPENAI_COMPAT_DEFAULT_BASE = "https://api.openai.com/v1";

/**
 * Throw a provider error with an HTTP `status` field for retry classification.
 *
 * @param message - Error message
 * @param status - HTTP status
 */
function throwHttp(message: string, status: number): never {
  const err = new Error(message) as Error & { status: number };
  err.status = status;
  throw err;
}

/**
 * Normalize a chat/embeddings base URL (strip trailing slash).
 *
 * @param raw - Base URL
 */
export function normalizeOpenaiCompatibleBaseUrl(raw: string): string {
  return raw.trim().replace(/\/$/, "");
}

/**
 * Whether this base is the OpenAI cloud default (key required).
 *
 * @param baseUrl - Normalized base
 */
export function isOpenaiCloudBase(baseUrl: string): boolean {
  return normalizeOpenaiCompatibleBaseUrl(baseUrl) === OPENAI_COMPAT_DEFAULT_BASE;
}

/**
 * Build request headers: content-type, optional Bearer, optional extras.
 *
 * @param apiKey - Bearer token when present
 * @param extra - Caller headers
 */
export function openaiCompatibleHeaders(
  apiKey: string | undefined,
  extra?: Readonly<Record<string, string>>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    ...(extra ?? {}),
  };
  if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

/**
 * Open an OpenAI-compatible chat / embeddings client.
 *
 * apiKey is required for the default OpenAI cloud base. Custom `baseUrl`
 * (LM Studio, Ollama `/v1`, Groq, …) may omit the key — Authorization is
 * then omitted. HTTP failures always throw (never silent mock fallback).
 *
 * @param options - API key / model / base URL / headers / injectable fetch
 */
export async function openOpenaiCompatible(options: AiOpenOptions = {}): Promise<AiModelClient> {
  const baseUrl = normalizeOpenaiCompatibleBaseUrl(options.baseUrl ?? OPENAI_COMPAT_DEFAULT_BASE);
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (isOpenaiCloudBase(baseUrl) && !apiKey) {
    throw new Error("openai-compatible: apiKey is required (or OPENAI_API_KEY)");
  }
  const model = options.model ?? "gpt-4o-mini";
  const fetchFn = options.fetch ?? globalThis.fetch;
  const extraHeaders = options.headers;
  preconnectFetch(fetchFn, baseUrl);

  return {
    driverId: "openai-compatible",
    model,
    async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
      const resolvedModel = opts.model ?? model;
      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: opts.messages.map(serializeMessage),
      };
      if (opts.temperature !== undefined) body.temperature = opts.temperature;
      if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;
      if (opts.responseFormat !== undefined) {
        body.response_format = wireOpenaiResponseFormat(opts.responseFormat);
      }
      if (opts.tools !== undefined && opts.tools.length > 0) {
        body.tools = opts.tools.map((t) => ({
          type: "function",
          function: {
            name: t.name,
            ...(t.description !== undefined ? { description: t.description } : {}),
            ...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
          },
        }));
      }

      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: openaiCompatibleHeaders(apiKey, extraHeaders),
        body: JSON.stringify(body),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      const raw = (await res.json().catch(() => ({}))) as OpenAiChatResponse;
      if (!res.ok) {
        const msg = raw.error?.message ?? `openai-compatible HTTP ${res.status}`;
        throwHttp(`openai-compatible: ${msg}`, res.status);
      }
      const message = raw.choices?.[0]?.message;
      const text = message?.content ?? "";
      const toolCalls = parseToolCalls(message?.tool_calls);
      return {
        text,
        raw,
        model: raw.model ?? resolvedModel,
        driverId: "openai-compatible",
        ...(toolCalls !== undefined ? { toolCalls } : {}),
        usage: {
          inputTokens: raw.usage?.prompt_tokens,
          outputTokens: raw.usage?.completion_tokens,
        },
      };
    },
    async *stream(opts: AiCompleteOptions): AsyncIterable<AiStreamChunk> {
      const resolvedModel = opts.model ?? model;
      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: opts.messages.map(serializeMessage),
        stream: true,
      };
      if (opts.temperature !== undefined) body.temperature = opts.temperature;
      if (opts.maxTokens !== undefined) body.max_tokens = opts.maxTokens;

      const res = await fetchFn(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: openaiCompatibleHeaders(apiKey, extraHeaders),
        body: JSON.stringify(body),
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      if (!res.ok) {
        const raw = (await res.json().catch(() => ({}))) as OpenAiChatResponse;
        const msg = raw.error?.message ?? `openai-compatible HTTP ${res.status}`;
        throwHttp(`openai-compatible: ${msg}`, res.status);
      }
      yield* readOpenaiSse(res, opts.signal);
    },
    async embed(opts: AiEmbedOptions): Promise<AiEmbedResult> {
      const resolvedModel = opts.model ?? model;
      const input = opts.input;
      const res = await fetchFn(`${baseUrl}/embeddings`, {
        method: "POST",
        headers: openaiCompatibleHeaders(apiKey, extraHeaders),
        body: JSON.stringify({ model: resolvedModel, input }),
      });
      const raw = (await res.json().catch(() => ({}))) as OpenAiEmbedResponse;
      if (!res.ok) {
        const msg = raw.error?.message ?? `openai-compatible embed HTTP ${res.status}`;
        throwHttp(`openai-compatible: ${msg}`, res.status);
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

/**
 * llama.cpp granite empties `content` on `json_schema`; `json_object` plus
 * the ask-time schema instruction is the portable contract.
 *
 * @param responseFormat - Runtime format (may be json_schema)
 */
function wireOpenaiResponseFormat(responseFormat: unknown): unknown {
  if (
    responseFormat &&
    typeof responseFormat === "object" &&
    "type" in responseFormat &&
    (responseFormat as { type?: unknown }).type === "json_schema"
  ) {
    return { type: "json_object" };
  }
  return responseFormat;
}

function serializeMessage(m: AiCompleteOptions["messages"][number]): Record<string, unknown> {
  const out: Record<string, unknown> = {
    role: m.role,
    content: m.content,
  };
  if (m.name !== undefined) out.name = m.name;
  if (m.toolCallId !== undefined) out.tool_call_id = m.toolCallId;
  if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
    out.tool_calls = m.toolCalls.map((tc) => ({
      id: tc.id,
      type: "function",
      function: {
        name: tc.name,
        arguments:
          typeof tc.arguments === "string" ? tc.arguments : JSON.stringify(tc.arguments ?? {}),
      },
    }));
  }
  return out;
}

function parseToolCalls(
  raw: readonly OpenAiToolCall[] | undefined,
): readonly AiToolCall[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((tc, i) => {
    const name = tc.function?.name ?? "";
    const argStr = tc.function?.arguments ?? "{}";
    let args: unknown = argStr;
    try {
      args = JSON.parse(argStr) as unknown;
    } catch {
      args = { _raw: argStr };
    }
    return {
      id: tc.id ?? `call_${i}`,
      name,
      arguments: args,
    };
  });
}

/**
 * Parse OpenAI SSE chat.completion.chunk stream.
 *
 * @param res - Streaming response
 * @param signal - Optional abort
 */
async function* readOpenaiSse(res: Response, signal?: AbortSignal): AsyncGenerator<AiStreamChunk> {
  let buffer = "";
  for await (const piece of responseTextStream(res)) {
    if (signal?.aborted) throw abortAsError(signal.reason);
    buffer += piece;
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") {
        yield { text: "", done: true };
        return;
      }
      try {
        const chunk = JSON.parse(data) as {
          choices?: readonly {
            delta?: { content?: string | null };
            finish_reason?: string | null;
          }[];
        };
        const delta = chunk.choices?.[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { text: delta };
        }
        if (chunk.choices?.[0]?.finish_reason) {
          yield { text: "", done: true };
          return;
        }
      } catch {
        // ignore malformed SSE lines
      }
    }
  }
  yield { text: "", done: true };
}

/**
 * UTF-8 text chunks from a Response (`textStream` on Bun ≥1.4).
 *
 * @param res - HTTP response
 */
function responseTextStream(res: Response): AsyncIterable<string> {
  const stream = (res as Response & { textStream?: () => AsyncIterable<string> }).textStream;
  if (typeof stream !== "function") {
    throw new Error("openai-compatible: Response.textStream is required (Bun >= 1.4.1)");
  }
  return stream.call(res);
}

/**
 * Warm DNS+TCP+TLS for a cloud origin. No-op when `fetch` is a test stub.
 *
 * @param fetchFn - Fetch implementation
 * @param url - Provider base URL
 */
function preconnectFetch(fetchFn: typeof fetch, url: string): void {
  const preconnect = (fetchFn as { preconnect?: (href: string) => void }).preconnect;
  if (typeof preconnect === "function") {
    preconnect(url);
  }
}

function abortAsError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const err = new Error(reason !== undefined ? String(reason) : "This operation was aborted");
  err.name = "AbortError";
  return err;
}

interface OpenAiToolCall {
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: string };
}

interface OpenAiChatResponse {
  readonly model?: string;
  readonly choices?: readonly {
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: readonly OpenAiToolCall[];
    };
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
