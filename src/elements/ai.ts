/**
 * AI element — reaching machine intelligence.
 *
 * Physics: inference · prompts · embeddings · agents.
 * Drivers: `mock` (dev) · `anthropic` · `openai-compatible` · `bedrock` ·
 * `vertex` · `ollama`. No production default — prod must declare.
 *
 * Prompts are versioned artifacts with validated output shapes and eval sets
 * (`oke eval` gates CI). Agents' tools are the app's own flows (gates apply).
 * PII fields cannot reach a third-party model without explicit `allowPii`.
 * Nondeterministic ⇒ journaling forced, auto-cache disabled.
 * @module
 */

export { ai, listAiDecls, resetAiDecls } from "./ai/declare.ts";
export type {
  AiAgentDecl,
  AiAgentOptions,
  AiBudgetDecl,
  AiEmbedDecl,
  AiEmbedOptions,
  AiModelDecl,
  AiModelOptions,
  AiPromptDecl,
  AiPromptOptions,
  AiTimeout,
} from "./ai/declare.ts";

export {
  aiHttpError,
  isRetryableAiError,
  mergeAskAbortSignal,
  outExpectsVia,
  resolveTimeoutMs,
} from "./ai/errors.ts";
export type { AiErrorFields } from "./ai/errors.ts";

export {
  createAiRuntime,
  parsePromptRef,
  AiSchemaValidationError,
  promptContentFromInput,
  AI_DEFAULT_MAX_STEPS,
} from "./ai/runtime.ts";
export type {
  AgentDenial,
  AgentRunRecord,
  AgentToolEffect,
  AgentToolStep,
  AiAgentRunOptions,
  AiAskOptions,
  AiAskOutcome,
  AiFallbackAttempt,
  AiJournalEntry,
  AiRuntime,
  AiSchemaMismatch,
  AiStreamOptions,
  CreateAiRuntimeOptions,
} from "./ai/runtime.ts";

export { AI_RATE_PRESETS, aiRateGate, createAiRateGates } from "./ai/rate.ts";
export type { AiRatePreset } from "./ai/rate.ts";

export { assertAllowPiiForAsk, AiPiiBuildError, type PiiAskCheckInput } from "./ai/pii.ts";

export {
  runPromptEvals,
  parseEvalJsonl,
  type EvalCase,
  type EvalCaseResult,
  type EvalSuiteResult,
  type RunPromptEvalsOptions,
} from "./ai/eval.ts";
