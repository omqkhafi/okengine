/**
 * vLLM image recipe — production-tier local inference (`vllm/vllm-openai`).
 *
 * OpenAI-compatible server for multi-user GPU concurrency. Prefer a managed
 * provider unless you run inference yourself. Pin an explicit tag — never
 * `latest`. Host publish is loopback-only (same hard rule as llama.cpp).
 */

import type { ImageRecipe } from "../types.ts";

/** Pinned vLLM OpenAI server image — never `latest`. */
export const VLLM_IMAGE = "vllm/vllm-openai:v0.26.0";

/** vLLM — OpenAI-compatible HTTP on 8000; GPU reservation; loopback publish. */
export const vllm: ImageRecipe = {
  id: "vllm",
  port: 8000,
  match: (i) => /(?:^|\/)vllm(?:[:@/]|$)/i.test(i),
  apply: (s) => ({
    command: ["--model", "${OKE_AI_MODEL:-Qwen/Qwen3-0.6B}", "--host", "0.0.0.0", "--port", "8000"],
    environment: {
      OKE_AI_MODEL: "${OKE_AI_MODEL:-Qwen/Qwen3-0.6B}",
      HF_HOME: "/root/.cache/huggingface",
    },
    volumes: [`${s.serviceName}-models:/root/.cache/huggingface`],
    ipc: "host",
    publishBind: "127.0.0.1",
    deploy: {
      resources: {
        reservations: {
          devices: [{ driver: "nvidia", count: "all", capabilities: ["gpu"] }],
        },
      },
    },
    healthcheck: {
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:8000/health >/dev/null || exit 1"],
      interval: "10s",
      timeout: "5s",
      retries: 30,
      start_period: "120s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}/v1`,
};
