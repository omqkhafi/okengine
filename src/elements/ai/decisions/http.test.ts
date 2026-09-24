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
import { DecisionOutageError, DecisionRequestError } from "./provider.ts";

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

  test("429 retries without opening the breaker", async () => {
    resetDecisionBreakers();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      if (calls === 1) return new Response("slow", { status: 429, headers: { "retry-after": "0" } });
      return Response.json({ model: "jev", answers: { urgent: { noul: 0.9 } }, usage: {} });
    };
    const result = await decisionHttp({
      url: "https://example.test/decisions",
      apiKey: "test",
      request,
      timeoutMs: 1000,
      breakerKey: "openrouter-429",
      fetch: fetchImpl,
    });
    expect(result.model).toBe("jev");
    expect(calls).toBe(2);
    expect(decisionBreakerOpen("openrouter-429")).toBe(false);
  });

  test("500 counts toward the breaker and is not retried", async () => {
    resetDecisionBreakers();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("down", { status: 500 });
    };
    await expect(
      decisionHttp({
        url: "https://example.test/decisions",
        apiKey: "test",
        request,
        timeoutMs: 1000,
        breakerKey: "openrouter-500",
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(DecisionOutageError);
    expect(calls).toBe(1);
    await decisionHttp({
      url: "https://example.test/decisions",
      apiKey: "test",
      request,
      timeoutMs: 1000,
      breakerKey: "openrouter-500",
      fetch: fetchImpl,
    }).catch(() => undefined);
    await decisionHttp({
      url: "https://example.test/decisions",
      apiKey: "test",
      request,
      timeoutMs: 1000,
      breakerKey: "openrouter-500",
      fetch: fetchImpl,
    }).catch(() => undefined);
    expect(decisionBreakerOpen("openrouter-500")).toBe(true);
  });

  test("an aborted call is not retried", async () => {
    resetDecisionBreakers();
    let calls = 0;
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = async () => {
      calls += 1;
      return new Response("nope", { status: 429, headers: { "retry-after": "0" } });
    };
    await expect(
      decisionHttp({
        url: "https://example.test/decisions",
        apiKey: "test",
        request: { ...request, signal: controller.signal },
        timeoutMs: 1000,
        breakerKey: "openrouter-abort",
        fetch: fetchImpl,
      }),
    ).rejects.toThrow();
    expect(calls).toBeLessThanOrEqual(1);
    expect(decisionBreakerOpen("openrouter-abort")).toBe(false);
  });

  test("invalid JSON is not retried", async () => {
    resetDecisionBreakers();
    let calls = 0;
    const fetchImpl = async () => {
      calls += 1;
      return new Response("not-json", { status: 200, headers: { "content-type": "application/json" } });
    };
    await expect(
      decisionHttp({
        url: "https://example.test/decisions",
        apiKey: "test",
        request,
        timeoutMs: 1000,
        breakerKey: "openrouter-json",
        fetch: fetchImpl,
      }),
    ).rejects.toBeInstanceOf(DecisionRequestError);
    expect(calls).toBe(1);
    expect(decisionBreakerOpen("openrouter-json")).toBe(false);
  });
});
