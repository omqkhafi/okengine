/**
 * Ollama server URL helpers — Docker recipe / pull / detect (not an AI driver).
 *
 * OKE talks to Ollama via the `openai-compatible` driver at `…/v1`.
 */

/** Default Ollama listen origin (host installs + compose host port). */
export const OLLAMA_DEFAULT_BASE_URL = "http://127.0.0.1:11434";

/** Documented local-dev default model tag for Ollama library pulls. */
export const OLLAMA_DEFAULT_MODEL = "qwen3.5:9b";

/**
 * Normalize a base URL or bare `host:port` (as in `OLLAMA_HOST`) to an origin
 * (no `/v1` suffix — callers append `/v1` for openai-compatible).
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
 * OpenAI-compatible base URL for an Ollama server (`…/v1`).
 *
 * @param origin - Ollama origin (with or without trailing `/v1`)
 */
export function ollamaOpenaiCompatibleBaseUrl(origin: string = OLLAMA_DEFAULT_BASE_URL): string {
  return `${normalizeOllamaBaseUrl(origin)}/v1`;
}
