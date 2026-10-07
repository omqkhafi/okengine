/**
 * System One and OpenAI Decisions codecs.
 * Both become one internal answer. Loaded only from the decision module.
 */

import type { AiDecisionQuestion } from "../declare.ts";
import type { DeciderProtocol } from "../deciders/presets.ts";
import type { DecisionRequest, DecisionResponse, DecisionUsage, WireQuestion } from "./provider.ts";

/** One question after the codec. Refusal carries no text. */
export type NormalizedAnswer =
  | { readonly type: "boolean"; readonly probability: number }
  | {
      readonly type: "choice";
      readonly choice: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence?: number;
    }
  | {
      readonly type: "score";
      readonly score: string;
      readonly probabilities: Readonly<Record<string, number>>;
      readonly confidence?: number;
    }
  | { readonly type: "refusal" }
  | { readonly type: "malformed" };

/**
 * Token estimate used before a call. One token per four JSON characters.
 *
 * @param state - Calling input
 */
export function estimateDecisionTokens(state: unknown): number {
  const text = typeof state === "string" ? state : JSON.stringify(state ?? null);
  return Math.ceil(text.length / 4);
}

/**
 * Encode a request for the decider's protocol.
 *
 * @param protocol - `systemone` or `openai-decisions`
 * @param request - Model, state, and questions
 */
export function encodeDecisionRequest(
  protocol: DeciderProtocol,
  request: DecisionRequest,
): unknown {
  if (protocol === "systemone") {
    return {
      model: request.model,
      state: request.state,
      questions: request.questions,
    };
  }
  const input =
    typeof request.state === "string" ? request.state : JSON.stringify(request.state ?? null);
  return {
    model: request.model,
    input,
    questions: Object.entries(request.questions).map(([name, question]) =>
      encodeOpenAIQuestion(name, question),
    ),
  };
}

function encodeOpenAIQuestion(name: string, question: WireQuestion): unknown {
  if (question.type === "noul") {
    return { name, type: "predicate", instructions: question.instructions };
  }
  if (question.type === "choice") {
    return {
      name,
      type: "choice",
      instructions: question.instructions,
      choices: Object.entries(question.criteria).map(([value, description]) =>
        description == null || description === "" ? { value } : { value, description },
      ),
    };
  }
  return {
    name,
    type: "score",
    instructions: question.instructions,
    levels: question.criteria.map((label) => ({ label })),
  };
}

/**
 * Normalize a parsed provider body. Malformed answers stay on the question id.
 *
 * @param protocol - Decider protocol
 * @param body - Parsed JSON, or an already parsed {@link DecisionResponse}
 */
export function normalizeDecisionResponse(
  protocol: DeciderProtocol,
  body: unknown,
): DecisionResponse {
  if (!body || typeof body !== "object") {
    return { model: "", answers: {}, usage: {} };
  }
  const record = body as {
    model?: unknown;
    provider?: unknown;
    answers?: unknown;
    usage?: unknown;
  };
  const model = typeof record.model === "string" ? record.model : "";
  const answers =
    protocol === "openai-decisions"
      ? normalizeOpenAIAnswers(record.answers)
      : normalizeSystemOneAnswers(record.answers);
  return {
    model,
    ...(typeof record.provider === "string" ? { provider: record.provider } : {}),
    answers,
    usage: usageFrom(record.usage),
  };
}

function normalizeSystemOneAnswers(raw: unknown): Record<string, NormalizedAnswer> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const answers: Record<string, NormalizedAnswer> = {};
  for (const [id, value] of Object.entries(raw)) {
    answers[id] = normalizeSystemOneAnswer(value);
  }
  return answers;
}

function normalizeSystemOneAnswer(value: unknown): NormalizedAnswer {
  if (!value || typeof value !== "object") return { type: "malformed" };
  const record = value as Record<string, unknown>;
  if (record.type === "noul" && typeof record.noul === "number") {
    return { type: "boolean", probability: record.noul };
  }
  if (record.type === "choice") {
    const probabilities = numberRecord(record.probabilities);
    const choice =
      typeof record.choice === "string"
        ? record.choice
        : probabilities
          ? argmax(probabilities)
          : "";
    if (!probabilities || !choice) return { type: "malformed" };
    return {
      type: "choice",
      choice,
      probabilities,
      ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    };
  }
  if (record.type === "score") {
    const probabilities = numberRecord(record.probabilities);
    if (!probabilities) return { type: "malformed" };
    const score =
      typeof record.score === "string"
        ? record.score
        : typeof record.score === "number"
          ? String(record.score)
          : argmax(probabilities);
    return {
      type: "score",
      score,
      probabilities,
      ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    };
  }
  if (record.type === "refusal") return { type: "refusal" };
  return { type: "malformed" };
}

function normalizeOpenAIAnswers(raw: unknown): Record<string, NormalizedAnswer> {
  if (!Array.isArray(raw)) return {};
  const answers: Record<string, NormalizedAnswer> = {};
  for (const value of raw) {
    if (!value || typeof value !== "object") continue;
    const record = value as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    if (!name) continue;
    answers[name] = normalizeOpenAIAnswer(record);
  }
  return answers;
}

function normalizeOpenAIAnswer(record: Record<string, unknown>): NormalizedAnswer {
  if (record.type === "refusal") return { type: "refusal" };
  if (record.type === "predicate" && typeof record.probability === "number") {
    return { type: "boolean", probability: record.probability };
  }
  if (record.type === "choice" && typeof record.choice === "string") {
    const probabilities = probabilityList(record.probabilities, "value");
    if (!probabilities) return { type: "malformed" };
    return {
      type: "choice",
      choice: String(record.choice),
      probabilities,
      ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    };
  }
  if (record.type === "score") {
    const probabilities = probabilityList(record.probabilities, "label");
    if (!probabilities) return { type: "malformed" };
    const score = typeof record.score === "string" ? record.score : argmax(probabilities);
    return {
      type: "score",
      score,
      probabilities,
      ...(typeof record.confidence === "number" ? { confidence: record.confidence } : {}),
    };
  }
  return { type: "malformed" };
}

function probabilityList(raw: unknown, key: "value" | "label"): Record<string, number> | undefined {
  if (!Array.isArray(raw)) return undefined;
  const probabilities: Record<string, number> = {};
  for (const item of raw) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as Record<string, unknown>;
    const name = row[key];
    if (
      (typeof name !== "string" && typeof name !== "boolean" && typeof name !== "number") ||
      typeof row.probability !== "number"
    ) {
      return undefined;
    }
    probabilities[String(name)] = row.probability;
  }
  return probabilities;
}

function numberRecord(raw: unknown): Record<string, number> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const probabilities: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value !== "number") return undefined;
    probabilities[key] = value;
  }
  return probabilities;
}

function argmax(probabilities: Readonly<Record<string, number>>): string {
  let best = "";
  let score = -1;
  for (const [key, value] of Object.entries(probabilities)) {
    if (value > score) {
      best = key;
      score = value;
    }
  }
  return best;
}

function usageFrom(raw: unknown): DecisionUsage {
  if (!raw || typeof raw !== "object") return {};
  const usage = raw as {
    input_tokens?: unknown;
    output_tokens?: unknown;
    cost?: unknown;
    inputTokens?: unknown;
    outputTokens?: unknown;
  };
  const input = usage.input_tokens ?? usage.inputTokens;
  const output = usage.output_tokens ?? usage.outputTokens;
  return {
    ...(typeof input === "number" ? { inputTokens: input } : {}),
    ...(typeof output === "number" ? { outputTokens: output } : {}),
    ...(typeof usage.cost === "number" ? { cost: usage.cost } : {}),
  };
}

/**
 * Wire questions for one decision. Choice always injects `none_of_these`.
 *
 * @param ask - Declared questions
 */
export function wireQuestions(
  ask: Readonly<Record<string, AiDecisionQuestion>>,
): Record<string, WireQuestion> {
  const questions: Record<string, WireQuestion> = {};
  for (const [id, question] of Object.entries(ask)) {
    questions[id] = wireQuestion(question);
  }
  return questions;
}

function wireQuestion(question: AiDecisionQuestion): WireQuestion {
  if (question.kind === "choice") {
    return {
      type: "choice",
      instructions: question.instructions,
      criteria: { ...question.options, none_of_these: null },
    };
  }
  if (question.kind === "score") {
    return { type: "score", instructions: question.instructions, criteria: question.levels };
  }
  return {
    type: "noul",
    instructions: question.instructions,
    ...(question.criteria !== undefined ? { criteria: question.criteria } : {}),
  };
}
