/**
 * `ollama` AI driver — thin fetch client for the native Ollama HTTP API.
 *
 * Any pulled model works via `model` / `OKE_AI_MODEL`. The documented local-dev
 * default is `qwen3.5:9b` (balanced starting point — override freely; on Apple
 * Silicon consider `qwen3.5:9b-mlx`). Fail-loud:
 * configured but unreachable throws {@link OllamaUnavailableError} — never a
 * silent mock fallback.
 *
 * Native API: `POST /api/chat` and `POST /api/embeddings` (not the OpenAI-compat
 * shim). Default base URL `http://127.0.0.1:11434`. Supports `complete`,
 * `stream` (NDJSON), `embed`, and tools.
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

/** Documented local-dev default — override via `model` / `OKE_AI_MODEL`. */
export const OLLAMA_DEFAULT_MODEL = "qwen3.5:9b";

/** Default Ollama listen URL (host installs + compose host port). */
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/** Error thrown when Ollama is unreachable / unhealthy / rejects a call. */
export class OllamaUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OllamaUnavailableError";
  }
}

/**
 * Normalize a base URL or bare `host:port` (as in `OLLAMA_HOST`) to an origin.
 *
 * @param raw - URL or host:port
 */
export function normalizeOllamaBaseUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return OLLAMA_DEFAULT_BASE_URL;
  if (/^https?:\/\//i.test(trimmed)) return trimmed.replace(/\/v1\/?$/i, "");
  return `http://${trimmed}`;
}

/**
 * Resolve the Ollama base URL from options / env (never invent a cloud endpoint).
 *
 * @param options - Open options
 */
export function resolveOllamaBaseUrl(options: AiOpenOptions = {}): string {
  const raw =
    options.baseUrl?.trim() ||
    process.env.OKE_AI_URL?.trim() ||
    process.env.OLLAMA_HOST?.trim() ||
    OLLAMA_DEFAULT_BASE_URL;
  return normalizeOllamaBaseUrl(raw);
}

/**
 * Resolve the model name — fully configurable; documented default only.
 *
 * @param options - Open options
 * @param override - Per-call model override
 */
export function resolveOllamaModel(options: AiOpenOptions = {}, override?: string): string {
  return (
    override?.trim() ||
    options.model?.trim() ||
    process.env.OKE_AI_MODEL?.trim() ||
    OLLAMA_DEFAULT_MODEL
  );
}

/**
 * Open an Ollama chat client. Health-checks `/api/tags` before returning.
 *
 * @param options - model / baseUrl / injectable fetch
 */
export async function openOllama(options: AiOpenOptions = {}): Promise<AiModelClient> {
  const baseUrl = resolveOllamaBaseUrl(options);
  const model = resolveOllamaModel(options);
  const fetchFn = options.fetch ?? globalThis.fetch;

  await healthCheck(baseUrl, fetchFn);

  return {
    driverId: "ollama",
    model,
    async complete(opts: AiCompleteOptions): Promise<AiCompleteResult> {
      const resolvedModel = resolveOllamaModel(options, opts.model);
      const body = buildChatBody(resolvedModel, opts, false);

      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw new OllamaUnavailableError(
          `ollama: unreachable at ${baseUrl} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }

      const raw = (await res.json().catch(() => ({}))) as OllamaChatResponse;
      if (!res.ok) {
        const msg = raw.error ?? `ollama HTTP ${res.status}`;
        throw new OllamaUnavailableError(`ollama: ${msg}`);
      }

      const text = raw.message?.content ?? "";
      const toolCalls = parseOllamaToolCalls(raw.message?.tool_calls);
      return {
        text,
        raw,
        model: raw.model ?? resolvedModel,
        driverId: "ollama",
        ...(toolCalls !== undefined ? { toolCalls } : {}),
        usage: {
          inputTokens: raw.prompt_eval_count,
          outputTokens: raw.eval_count,
        },
      };
    },
    async *stream(opts: AiCompleteOptions): AsyncIterable<AiStreamChunk> {
      const resolvedModel = resolveOllamaModel(options, opts.model);
      const body = buildChatBody(resolvedModel, opts, true);

      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        });
      } catch (err) {
        if (isAbortError(err)) throw err;
        throw new OllamaUnavailableError(
          `ollama: unreachable at ${baseUrl} — ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!res.ok) {
        const raw = (await res.json().catch(() => ({}))) as OllamaChatResponse;
        const msg = raw.error ?? `ollama HTTP ${res.status}`;
        throw new OllamaUnavailableError(`ollama: ${msg}`);
      }
      yield* readOllamaNdjson(res, opts.signal);
    },
    async embed(opts: AiEmbedOptions): Promise<AiEmbedResult> {
      const resolvedModel = resolveOllamaModel(options, opts.model);
      const inputs = Array.isArray(opts.input) ? opts.input : [opts.input];
      const vectors: number[][] = [];

      for (const prompt of inputs) {
        let res: Response;
        try {
          res = await fetchFn(`${baseUrl}/api/embeddings`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ model: resolvedModel, prompt }),
          });
        } catch (err) {
          throw new OllamaUnavailableError(
            `ollama: unreachable at ${baseUrl} — ${err instanceof Error ? err.message : String(err)}`,
          );
        }
        const raw = (await res.json().catch(() => ({}))) as OllamaEmbedResponse;
        if (!res.ok) {
          const msg = raw.error ?? `ollama embed HTTP ${res.status}`;
          throw new OllamaUnavailableError(`ollama: ${msg}`);
        }
        if (!Array.isArray(raw.embedding)) {
          throw new OllamaUnavailableError("ollama: embed response missing embedding");
        }
        vectors.push(raw.embedding);
      }

      return {
        vectors,
        model: resolvedModel,
        driverId: "ollama",
      };
    },
  };
}

/** Protocol-named ollama driver. */
export const ollamaAiDriver: AiDriver = {
  id: "ollama",
  open: openOllama,
};

function buildChatBody(
  resolvedModel: string,
  opts: AiCompleteOptions,
  stream: boolean,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: opts.messages.map((m) => {
      const msg: Record<string, unknown> = {
        role: m.role,
        content: m.content,
      };
      if (m.name !== undefined) msg.name = m.name;
      if (m.toolCalls !== undefined && m.toolCalls.length > 0) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          type: "function",
          function: {
            name: tc.name,
            arguments: tc.arguments,
          },
        }));
      }
      return msg;
    }),
    stream,
    // Thinking models (e.g. qwen3 / qwen3.5) otherwise spend the token budget in
    // `message.thinking` and leave `content` empty — baseline complete
    // wants the answer text.
    think: false,
  };
  const modelOptions: Record<string, unknown> = {};
  if (opts.temperature !== undefined) modelOptions.temperature = opts.temperature;
  if (opts.maxTokens !== undefined) modelOptions.num_predict = opts.maxTokens;
  if (Object.keys(modelOptions).length > 0) body.options = modelOptions;
  if (opts.responseFormat !== undefined) body.format = opts.responseFormat;
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
  return body;
}

function parseOllamaToolCalls(
  raw: readonly OllamaToolCall[] | undefined,
): readonly AiToolCall[] | undefined {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((tc, i) => ({
    id: `ollama_call_${i}`,
    name: tc.function?.name ?? "",
    arguments: tc.function?.arguments ?? {},
  }));
}

/**
 * Parse Ollama NDJSON stream lines via {@link Bun.JSONL.parseChunk}.
 *
 * @param res - Streaming response
 * @param signal - Optional abort
 */
async function* readOllamaNdjson(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<AiStreamChunk> {
  const reader = res.body?.getReader();
  if (!reader) {
    throw new OllamaUnavailableError("ollama: stream response has no body");
  }
  const decoder = new TextDecoder();
  let pending = "";
  try {
    while (true) {
      if (signal?.aborted) throw abortAsError(signal.reason);
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const parsed = bunJsonl().parseChunk(pending);
      pending = pending.slice(parsed.read);
      for (const row of parsed.values) {
        const chunk = row as OllamaChatResponse;
        const delta = chunk.message?.content;
        if (typeof delta === "string" && delta.length > 0) {
          yield { text: delta };
        }
        if (chunk.done) {
          yield { text: "", done: true };
          return;
        }
      }
      if (parsed.error) {
        const nl = pending.indexOf("\n");
        if (nl === -1) continue;
        pending = pending.slice(nl + 1);
      }
    }
    yield { text: "", done: true };
  } finally {
    reader.releaseLock();
  }
}

interface BunJsonlParse {
  readonly values: readonly unknown[];
  readonly read: number;
  readonly done: boolean;
  readonly error: unknown;
}

function bunJsonl(): {
  parse(text: string): unknown[];
  parseChunk(text: string): BunJsonlParse;
} {
  const jsonl = (
    Bun as typeof Bun & {
      JSONL?: { parse: (t: string) => unknown[]; parseChunk: (t: string) => BunJsonlParse };
    }
  ).JSONL;
  if (!jsonl) {
    throw new Error("ollama: Bun.JSONL is required (Bun >= 1.4.0)");
  }
  return jsonl;
}

/**
 * Probe Ollama — fail loud before the first completion.
 *
 * @param baseUrl - Origin
 * @param fetchFn - Injectable fetch
 */
async function healthCheck(baseUrl: string, fetchFn: typeof globalThis.fetch): Promise<void> {
  let res: Response;
  try {
    res = await fetchFn(`${baseUrl}/api/tags`, { method: "GET" });
  } catch (err) {
    throw new OllamaUnavailableError(
      `ollama: unreachable at ${baseUrl} — ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new OllamaUnavailableError(
      `ollama: health check failed at ${baseUrl}/api/tags (${res.status})${
        detail ? ` — ${detail.slice(0, 200)}` : ""
      }`,
    );
  }
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && err.name === "AbortError";
}

function abortAsError(reason?: unknown): Error {
  if (reason instanceof Error) return reason;
  const err = new Error(reason !== undefined ? String(reason) : "This operation was aborted");
  err.name = "AbortError";
  return err;
}

interface OllamaToolCall {
  readonly function?: { readonly name?: string; readonly arguments?: unknown };
}

interface OllamaChatResponse {
  readonly model?: string;
  readonly message?: {
    readonly role?: string;
    readonly content?: string;
    readonly tool_calls?: readonly OllamaToolCall[];
  };
  readonly done?: boolean;
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
  readonly error?: string;
}

interface OllamaEmbedResponse {
  readonly embedding?: readonly number[];
  readonly error?: string;
}
