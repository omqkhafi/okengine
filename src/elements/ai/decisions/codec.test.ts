/**
 * Codec round-trips for the verified System One body and the OpenAI decisions wire.
 */

import { describe, expect, test } from "bun:test";
import { ai } from "../../ai.ts";
import { encodeDecisionRequest, normalizeDecisionResponse, wireQuestions } from "./codec.ts";

const openRouterBody = {
  model: "typesafe/jev-1.13-20260917",
  answers: {
    team: {
      type: "choice",
      choice: "technical",
      probabilities: { billing: 0.49, none_of_these: 0.02, technical: 0.49 },
      confidence: 0.23,
    },
    urgent: { type: "noul", noul: 0.54 },
  },
  usage: { input_tokens: 348, output_tokens: 58, cost: 0.000014616 },
  id: "gen-dec-1791389894-FvrNcwqrVRdAEvlEDRh9",
  provider: "TypeSafe",
};

describe("decision codecs", () => {
  test("System One normalizes the verified OpenRouter body", () => {
    const response = normalizeDecisionResponse("systemone", openRouterBody);
    expect(response.model).toBe("typesafe/jev-1.13-20260917");
    expect(response.provider).toBe("TypeSafe");
    expect(response.usage).toEqual({ inputTokens: 348, outputTokens: 58, cost: 0.000014616 });
    expect(response.answers).toMatchObject({
      team: {
        type: "choice",
        choice: "technical",
        probabilities: { billing: 0.49, none_of_these: 0.02, technical: 0.49 },
      },
      urgent: { type: "boolean", probability: 0.54 },
    });
  });

  test("a choice without a choice string uses the highest probability", () => {
    const response = normalizeDecisionResponse("systemone", {
      model: "m",
      answers: {
        team: { type: "choice", probabilities: { billing: 0.2, technical: 0.8 } },
      },
    });
    expect(response.answers).toMatchObject({
      team: { type: "choice", choice: "technical" },
    });
  });

  test("refusal drops the text and a partial body is malformed", () => {
    const response = normalizeDecisionResponse("systemone", {
      model: "m",
      answers: {
        team: { type: "refusal", text: "not a label" },
        urgent: { type: "choice" },
        empty: { nope: true },
      },
    });
    expect(response.answers).toEqual({
      team: { type: "refusal" },
      urgent: { type: "malformed" },
      empty: { type: "malformed" },
    });
    expect(JSON.stringify(response.answers)).not.toContain("not a label");
  });

  test("OpenAI decisions encode and normalize predicate, choice, score, and refusal", () => {
    const questions = wireQuestions({
      urgent: ai.boolean("Does this need a person today?"),
      team: ai.choice("Which team owns this ticket?", {
        billing: "Billing",
        technical: "Technical",
      }),
      severity: ai.score("How severe is this?", ["low", "high"]),
    });
    const encoded = encodeDecisionRequest("openai-decisions", {
      model: "gpt-6-luna",
      state: { ticket: "Checkout is blank" },
      questions,
    }) as {
      model: string;
      input: string;
      questions: {
        name: string;
        type: string;
        choices?: { value: string }[];
        levels?: { label: string }[];
      }[];
    };
    expect(encoded.model).toBe("gpt-6-luna");
    expect(encoded.input).toBe(JSON.stringify({ ticket: "Checkout is blank" }));
    expect(encoded.questions.map((question) => question.type)).toEqual([
      "predicate",
      "choice",
      "score",
    ]);
    expect(encoded.questions[1]?.choices?.map((choice) => choice.value)).toEqual([
      "billing",
      "technical",
      "none_of_these",
    ]);
    expect(encoded.questions[2]?.levels).toEqual([{ label: "low" }, { label: "high" }]);

    const response = normalizeDecisionResponse("openai-decisions", {
      model: "gpt-6-luna",
      answers: [
        { name: "urgent", type: "predicate", probability: 0.12 },
        {
          name: "team",
          type: "choice",
          choice: "none_of_these",
          probabilities: [
            { value: "billing", probability: 0.1 },
            { value: "technical", probability: 0.2 },
            { value: "none_of_these", probability: 0.7 },
          ],
        },
        {
          name: "severity",
          type: "score",
          score: "low",
          probabilities: [
            { label: "low", probability: 0.8 },
            { label: "high", probability: 0.2 },
          ],
        },
        { name: "held", type: "refusal" },
      ],
      usage: { input_tokens: 20, output_tokens: 8 },
    });
    expect(response.model).toBe("gpt-6-luna");
    expect(response.answers).toMatchObject({
      urgent: { type: "boolean", probability: 0.12 },
      team: { type: "choice", choice: "none_of_these" },
      severity: { type: "score", score: "low", probabilities: { low: 0.8, high: 0.2 } },
      held: { type: "refusal" },
    });
  });
});
