/**
 * `ollama` AI driver — thin fetch client for the native Ollama HTTP API.
 *
 * Any pulled model works via `model` / `OKE_AI_MODEL`. The documented local-dev
 * default is `qwen3:8b` (balanced starting point — override freely). Fail-loud:
 * configured but unreachable throws {@link OllamaUnavailableError} — never a
 * silent mock fallback. Streaming and tool-calling are out of scope for this
 * baseline; `complete` only.
 *
 * Native API: `POST /api/chat` with `stream: false` (not the OpenAI-compat
 * shim). Default base URL `http://127.0.0.1:11434`.
 */

import type {
  AiCompleteOptions,
  AiCompleteResult,
  AiDriver,
  AiModelClient,
  AiOpenOptions,
} from "./ai-types.ts";

/** Documented local-dev default — override via `model` / `OKE_AI_MODEL`. */
export const OLLAMA_DEFAULT_MODEL = "qwen3:8b";

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
      const body: Record<string, unknown> = {
        model: resolvedModel,
        messages: opts.messages.map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.name !== undefined ? { name: m.name } : {}),
        })),
        stream: false,
        // Thinking models (e.g. qwen3) otherwise spend the token budget in
        // `message.thinking` and leave `content` empty — baseline complete
        // wants the answer text. Streaming / deep think is a later pass.
        think: false,
      };
      const modelOptions: Record<string, unknown> = {};
      if (opts.temperature !== undefined) modelOptions.temperature = opts.temperature;
      if (opts.maxTokens !== undefined) modelOptions.num_predict = opts.maxTokens;
      if (Object.keys(modelOptions).length > 0) body.options = modelOptions;
      if (opts.responseFormat !== undefined) body.format = opts.responseFormat;

      let res: Response;
      try {
        res = await fetchFn(`${baseUrl}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
      } catch (err) {
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
      return {
        text,
        raw,
        model: raw.model ?? resolvedModel,
        driverId: "ollama",
        usage: {
          inputTokens: raw.prompt_eval_count,
          outputTokens: raw.eval_count,
        },
      };
    },
  };
}

/** Protocol-named ollama driver. */
export const ollamaAiDriver: AiDriver = {
  id: "ollama",
  open: openOllama,
};

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

interface OllamaChatResponse {
  readonly model?: string;
  readonly message?: { readonly role?: string; readonly content?: string };
  readonly prompt_eval_count?: number;
  readonly eval_count?: number;
  readonly error?: string;
}
