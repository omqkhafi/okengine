/**
 * Protocol-named re-export — prefer `okengine/drivers/ai-ollama` or
 * `okengine/drivers` (`ollamaAiDriver`). Same surface as {@link ./ai-ollama.ts}.
 */
export {
  ollamaAiDriver,
  openOllama,
  OllamaUnavailableError,
  OLLAMA_DEFAULT_MODEL,
  OLLAMA_DEFAULT_BASE_URL,
  normalizeOllamaBaseUrl,
  resolveOllamaBaseUrl,
  resolveOllamaModel,
} from "./ai-ollama.ts";
