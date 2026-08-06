/**
 * SGLang image recipe — production-tier structured/agent inference.
 *
 * Prefer a managed provider unless you run inference yourself. Use SGLang when
 * the workload is structured generation / agent-heavy on real GPU hardware;
 * use vLLM for general multi-user serving. Pin an explicit tag — never
 * `latest`. Host publish is loopback-only.
 */

import type { ImageRecipe } from "../types.ts";

/** Pinned SGLang runtime image — never `latest`. */
export const SGLANG_IMAGE = "lmsysorg/sglang:v0.5.16-runtime";

/** SGLang — OpenAI-compatible HTTP on 30000; GPU reservation; loopback publish. */
export const sglang: ImageRecipe = {
  id: "sglang",
  port: 30000,
  match: (i) => /sglang/i.test(i),
  apply: (s) => ({
    command: [
      "python3",
      "-m",
      "sglang.launch_server",
      "--model-path",
      "${OKE_AI_MODEL:-Qwen/Qwen3-0.6B}",
      "--host",
      "0.0.0.0",
      "--port",
      "30000",
    ],
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
      test: ["CMD-SHELL", "curl -fsS http://127.0.0.1:30000/health >/dev/null || exit 1"],
      interval: "10s",
      timeout: "5s",
      retries: 30,
      start_period: "120s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}/v1`,
};
