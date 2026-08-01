/**
 * Ollama image recipe — local model server (`ollama/ollama`).
 *
 * Serves on 11434 and pulls the configured model after serve is up.
 * `OKE_AI_MODEL` defaults to `qwen3.5:9b` (balanced local-dev starting point —
 * override freely); models persist on a named volume under `/root/.ollama`.
 */

import type { ImageRecipe } from "../types.ts";

/** Start serve, pull configured model, keep serve in foreground. */
const OLLAMA_BOOT = [
  "set -e",
  "/bin/ollama serve &",
  "pid=$!",
  'i=0; until /bin/ollama list >/dev/null 2>&1; do i=$((i+1)); [ "$i" -lt 90 ] || exit 1; sleep 1; done',
  '/bin/ollama pull "${OKE_AI_MODEL:-qwen3.5:9b}"',
  "wait $pid",
].join("; ");

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
    entrypoint: ["/bin/sh", "-c"],
    command: [OLLAMA_BOOT],
    volumes: [`${s.serviceName}-data:/root/.ollama`],
    healthcheck: {
      test: ["CMD-SHELL", "/bin/ollama list >/dev/null 2>&1 || exit 1"],
      interval: "5s",
      timeout: "5s",
      retries: 60,
      start_period: "20s",
    },
  }),
  url: (_s, c) => `http://${c.host}:${c.port}`,
};
