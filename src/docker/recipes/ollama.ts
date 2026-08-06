/**
 * Ollama image recipe — local model server (`ollama/ollama`).
 *
 * Fully supported alternative to the default llama.cpp recipe. Pin ≥
 * {@link OLLAMA_MIN_SAFE_VERSION} (CVE-2026-7482 floor). Host publish is
 * loopback-only — never expose `:11434` on `0.0.0.0`. Load models only from
 * Ollama's library; do not feed arbitrary untrusted GGUF into `/api/create`.
 *
 * Model pull is **not** done here: after compose is up,
 * {@link ensureOllamaModel} POSTs `/api/pull` to this container's loopback URL.
 */

import type { ImageRecipe } from "../types.ts";

/** Minimum safe Ollama release (CVE-2026-7482 — own Go GGUF loader). */
export const OLLAMA_MIN_SAFE_VERSION = "0.17.1";

/** Pinned default Ollama image — verified ≥ {@link OLLAMA_MIN_SAFE_VERSION}; never `latest`. */
export const OLLAMA_IMAGE = "ollama/ollama:0.32.6";

/** Ollama local model server. API on 11434; loopback publish only. */
export const ollama: ImageRecipe = {
  id: "ollama",
  port: 11434,
  match: (i) => /(?:^|\/)ollama(?:[:@/]|$)/i.test(i),
  apply: (s) => ({
    environment: {
      // Listen on all interfaces *inside* the container (Docker networking).
      // Host publish uses publishBind — never 0.0.0.0 on the host.
      OLLAMA_HOST: "0.0.0.0:11434",
      OKE_AI_MODEL: "${OKE_AI_MODEL:-qwen3.5:9b}",
    },
    volumes: [`${s.serviceName}-data:/root/.ollama`],
    publishBind: "127.0.0.1",
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
