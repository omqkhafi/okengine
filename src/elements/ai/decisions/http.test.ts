/**
 * Decision HTTP: fixtures parse, and 422 does not open the breaker.
 */

import { describe, expect, test } from "bun:test";
import openrouterResponse from "./fixtures/openrouter-response.json";
import typesafeResponse from "./fixtures/typesafe-response.json";
import {
  decisionBreakerOpen,
  decisionHttp,
  parseDecisionResponse,
  resetDecisionBreakers,
} from "./http.ts";
import { DecisionRequestError } from "./provider.ts";

const request = {
  model: "typesafe/jev-1.13",
  state: { ticket: "Checkout is blank after Pay." },
  questions: {
    urgent: { type: "noul" as const, instructions: "Does this convey urgency?" },
  },
};

describe("decision fixtures", () => {
  test("typesafe and openrouter bodies parse", () => {
    expect(parseDecisionResponse(typesafeResponse).model).toBe("jev-1.13.0");
    expect(parseDecisionResponse(openrouterResponse).provider).toBe("TypeSafe");
    expect(parseDecisionResponse(openrouterResponse).usage.cost).toBe(0.00001);
  });
});

describe("decision breaker", () => {
  test("422 fails fast and leaves the breaker closed", async () => {
    resetDecisionBreakers();
    const fetchImpl = async () => new Response("bad question", { status: 422 });
    await expect(
      decisionHttp({
        url: "https://openrouter.ai/api/alpha/decisions",
        apiKey: "test",
        request,
        timeoutMs: 1000,
        breakerKey: "openrouter-422",
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(DecisionRequestError);
    expect(decisionBreakerOpen("openrouter-422")).toBe(false);
  });
});
