/**
 * Ollama image recipe — local model server (`ollama/ollama`).
 *
 * Serves on 11434. Model pull is **not** done here: the official image has no
 * curl/wget, and a host `ollama` CLI would talk to whichever daemon owns the
 * default port. After compose is up, {@link ensureOllamaModel} POSTs
 * `/api/pull` to this container's exposed host URL.
 *
 * `OKE_AI_MODEL` defaults to `qwen3.5:9b`; weights persist on a named volume
 * under `/root/.ollama`.
 */

import type { ImageRecipe } from "../types.ts";

/** Ollama local model server. API on 11434. */
export const ollama: ImageRecipe = {
  id: "ollama",
  port: 11434,
  match: (i) => /ollama/i.test(i),
  apply: (s) => ({
    environment: {
      OLLAMA_HOST: "0.0.0.0:11434",
      OKE_AI_MODEL: "${OKE_AI_MODEL:-qwen3.5:9b}",
    },
    volumes: [`${s.serviceName}-data:/root/.ollama`],
    healthcheck: {
      test: ["CMD-SHELL", "/bin/ollama list >/dev/null 2>&1 || exit 1"],
      interval: "5s",
      timeout: "5s",
      retries: 24,
      start_period: "10s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}`,
};
