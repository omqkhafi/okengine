/**
 * Keel AI models, prompts, and the planner agent.
 *
 * Default path is OpenRouter (`openrouter/free`). For BYO, swap `smart` to
 * `openai-compatible` + `OKE_AI_URL` (any OpenAI-compatible `/v1`).
 */

import { ai } from "okengine";
import { z } from "zod";

const chatModel =
  process.env.OKE_AI_CLOUD_MODEL?.trim() ||
  process.env.OKE_AI_MODEL?.trim() ||
  "openrouter/free";

const smart = ai.model("smart", {
  provider: "openrouter",
  tier: "smart",
  model: chatModel,
  ...(process.env.OPENAI_BASE_URL?.trim()
    ? { baseUrl: process.env.OPENAI_BASE_URL.trim() }
    : {}),
  ...(process.env.OPENROUTER_API_KEY?.trim()
    ? { apiKey: process.env.OPENROUTER_API_KEY.trim() }
    : {}),
});
const fast = ai.model("fast", {
  provider: "openrouter",
  tier: "fast",
  model: chatModel,
  ...(process.env.OPENAI_BASE_URL?.trim()
    ? { baseUrl: process.env.OPENAI_BASE_URL.trim() }
    : {}),
  ...(process.env.OPENROUTER_API_KEY?.trim()
    ? { apiKey: process.env.OPENROUTER_API_KEY.trim() }
    : {}),
});

/** Task suggest — priority, section, role needed. */
export const taskSuggestPrompt = smart.prompt("task-suggest", {
  version: 1,
  via: ["smart", "fast"],
  timeout: "30s",
  budget: { maxCostPerCall: 0.02 },
  out: z.object({
    priority: z.number(),
    section: z.string(),
    roleNeeded: z.string(),
    summary: z.string(),
  }),
});

/** Weekly workspace summary. */
export const weeklySummaryPrompt = fast.prompt("weekly-summary", {
  version: 1,
  via: ["fast"],
  timeout: "15s",
  budget: { maxCostPerCall: 0.005 },
  out: z.object({ summary: z.string() }),
});

/** Form intake classify. */
export const formClassifyPrompt = fast.prompt("form-classify", {
  version: 1,
  via: ["fast"],
  timeout: "20s",
  budget: { maxCostPerCall: 0.008 },
  out: z.object({
    title: z.string(),
    roleNeeded: z.string(),
    priority: z.number(),
  }),
});

/** Document summary. */
export const documentSummaryPrompt = fast.prompt("document-summary", {
  version: 1,
  via: ["fast"],
  timeout: "20s",
  budget: { maxCostPerCall: 0.008 },
  out: z.object({ summary: z.string() }),
});

/** Planner agent — tools are keel flows. */
export const plannerAgent = ai.agent("planner", {
  tools: [
    "tasks.list",
    "tasks.get",
    "tasks.create",
    "tasks.assign",
    "comments.create",
    "inbox.list",
    "search.query",
  ],
  maxSteps: 8,
  model: "smart",
  budget: { maxCostPerRun: 0.25 },
});
