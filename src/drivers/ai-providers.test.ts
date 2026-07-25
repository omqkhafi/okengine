/**
 * Real AI provider drivers — injectable fetch (CI) · live key skip (optional).
 */

import { describe, expect, test } from "bun:test";
import { anthropicAiDriver, openAnthropic } from "./ai-anthropic.ts";
import {
  openaiCompatibleAiDriver,
  openOpenaiCompatible,
} from "./ai-openai-compatible.ts";
import { mockAiDriver } from "./ai-mock.ts";

describe("anthropic driver", () => {
  test("id is anthropic; mock remains the only default elsewhere", () => {
    expect(anthropicAiDriver.id).toBe("anthropic");
    expect(mockAiDriver.id).toBe("mock");
  });

  test("complete via injectable fetch (no network)", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchFn: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({ url: String(input), init });
        return new Response(
          JSON.stringify({
            model: "claude-test",
            content: [{ type: "text", text: '{"ok":true}' }],
            usage: { input_tokens: 3, output_tokens: 5 },
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    const client = await openAnthropic({
      apiKey: "sk-test",
      model: "claude-test",
      fetch: fetchFn,
    });
    const result = await client.complete({
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      maxTokens: 64,
    });

    expect(result.driverId).toBe("anthropic");
    expect(result.text).toBe('{"ok":true}');
    expect(result.usage?.inputTokens).toBe(3);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain("/v1/messages");
    const body = JSON.parse(String(calls[0]!.init?.body)) as {
      system?: string;
      messages: Array<{ role: string }>;
    };
    expect(body.system).toBe("be brief");
    expect(body.messages).toEqual([
      { role: "user", content: "hi" } as { role: string },
    ]);
  });

  test("HTTP error surfaces provider message", async () => {
    const fetchFn = Object.assign(
      async () =>
        new Response(JSON.stringify({ error: { message: "rate limited" } }), {
          status: 429,
        }),
      { preconnect: () => {} },
    ) as typeof fetch;
    const client = await openAnthropic({
      apiKey: "sk-test",
      fetch: fetchFn,
    });
    await expect(
      client.complete({ messages: [{ role: "user", content: "x" }] }),
    ).rejects.toThrow("rate limited");
  });

  test("live Anthropic ask when ANTHROPIC_API_KEY is set", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      // Clearly-marked skip — never fail CI for lack of credentials.
      console.log(
        "skip: live anthropic ask (ANTHROPIC_API_KEY not set)",
      );
      return;
    }
    const client = await anthropicAiDriver.open({
      apiKey: key,
      model: process.env.ANTHROPIC_MODEL ?? "claude-haiku-4-5-20251001",
    });
    const result = await client.complete({
      messages: [{ role: "user", content: 'Reply with exactly: {"pong":true}' }],
      maxTokens: 32,
    });
    expect(result.driverId).toBe("anthropic");
    expect(result.text.length).toBeGreaterThan(0);
  });
});

describe("openai-compatible driver", () => {
  test("id is openai-compatible", () => {
    expect(openaiCompatibleAiDriver.id).toBe("openai-compatible");
  });

  test("complete + embed via injectable fetch", async () => {
    const paths: string[] = [];
    const fetchFn: typeof fetch = Object.assign(
      async (input: string | URL | Request) => {
        const url = String(input);
        paths.push(url);
        if (url.includes("/embeddings")) {
          return new Response(
            JSON.stringify({
              model: "text-embedding-3-small",
              data: [{ index: 0, embedding: [0.1, 0.2] }],
            }),
            { status: 200 },
          );
        }
        return new Response(
          JSON.stringify({
            model: "gpt-test",
            choices: [{ message: { content: "hello" } }],
            usage: { prompt_tokens: 1, completion_tokens: 2 },
          }),
          { status: 200 },
        );
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    const client = await openOpenaiCompatible({
      apiKey: "sk-test",
      model: "gpt-test",
      baseUrl: "https://example.test/v1",
      fetch: fetchFn,
    });

    const chat = await client.complete({
      messages: [{ role: "user", content: "hi" }],
    });
    expect(chat.text).toBe("hello");
    expect(chat.driverId).toBe("openai-compatible");

    const emb = await client.embed!({ input: "hi" });
    expect(emb.vectors[0]).toEqual([0.1, 0.2]);
    expect(paths.some((p) => p.endsWith("/chat/completions"))).toBe(true);
    expect(paths.some((p) => p.endsWith("/embeddings"))).toBe(true);
  });

  test("requires apiKey", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(openOpenaiCompatible({})).rejects.toThrow("apiKey");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });
});
