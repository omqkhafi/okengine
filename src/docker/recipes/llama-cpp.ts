/**
 * llama.cpp image recipe — default local AI (`ghcr.io/ggml-org/llama.cpp`).
 *
 * OpenAI-compatible `llama-server` on 8080. Pin ≥ {@link LLAMA_CPP_MIN_SAFE_BUILD}
 * (CVE-2026-27940 / CVE-2026-33298 floor). Host publish is loopback-only;
 * never publish RPC. Models via Docker Hub `ai/` (`LLAMA_ARG_DOCKER_REPO`) —
 * do not load arbitrary untrusted GGUF files.
 */

import type { ImageRecipe } from "../types.ts";

/** Minimum safe llama.cpp build (GGUF parser CVEs through CVE-2026-27940). */
export const LLAMA_CPP_MIN_SAFE_BUILD = 8146;

/** Pinned default image — verified ≥ {@link LLAMA_CPP_MIN_SAFE_BUILD}; never `latest`. */
export const LLAMA_CPP_IMAGE = "ghcr.io/ggml-org/llama.cpp:server-b10290";

/** llama-server — OpenAI-compatible HTTP on 8080; loopback publish only. */
export const llamaCpp: ImageRecipe = {
  id: "llama-cpp",
  port: 8080,
  match: (i) => /llama\.cpp|llamacpp/i.test(i),
  apply: (s) => ({
    environment: {
      LLAMA_ARG_HOST: "0.0.0.0",
      LLAMA_ARG_PORT: "8080",
      // Curated Docker Hub `ai/<id>` — never an arbitrary untrusted GGUF path.
      LLAMA_ARG_DOCKER_REPO: "${OKE_AI_MODEL:-smollm2}",
      OKE_AI_MODEL: "${OKE_AI_MODEL:-smollm2}",
    },
    volumes: [`${s.serviceName}-models:/root/.cache`],
    publishBind: "127.0.0.1",
    healthcheck: {
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8080/health >/dev/null || exit 1"],
      interval: "5s",
      timeout: "5s",
      retries: 24,
      start_period: "30s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}/v1`,
};
