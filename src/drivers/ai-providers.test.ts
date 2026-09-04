/**
 * Real AI provider drivers — injectable fetch (CI) · live key skip (optional).
 */

import { describe, expect, test } from "bun:test";
import { anthropicAiDriver, openAnthropic } from "./ai-anthropic.ts";
import { mockAiDriver } from "./ai-mock.ts";
import { openaiCompatibleAiDriver, openOpenaiCompatible } from "./ai-openai-compatible.ts";
import {
  normalizeOllamaBaseUrl,
  OLLAMA_DEFAULT_MODEL,
  ollamaOpenaiCompatibleBaseUrl,
} from "../docker/ollama-url.ts";

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
    const ac = new AbortController();
    const result = await client.complete({
      messages: [
        { role: "system", content: "be brief" },
        { role: "user", content: "hi" },
      ],
      maxTokens: 64,
      signal: ac.signal,
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
    expect(body.messages).toEqual([{ role: "user", content: "hi" } as { role: string }]);
    expect(calls[0]!.init?.signal).toBe(ac.signal);
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
    await expect(client.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      "rate limited",
    );
  });

  test("live Anthropic ask when ANTHROPIC_API_KEY is set", async () => {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) {
      // Clearly-marked skip — never fail CI for lack of credentials.
      console.log("skip: live anthropic ask (ANTHROPIC_API_KEY not set)");
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

  test("requires apiKey for default OpenAI cloud base", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    try {
      await expect(openOpenaiCompatible({})).rejects.toThrow("apiKey");
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  test("custom baseUrl may omit apiKey (local / self-hosted)", async () => {
    const prev = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    const headersSeen: Array<Record<string, string> | undefined> = [];
    try {
      const fetchFn: typeof fetch = Object.assign(
        async (_input: string | URL | Request, init?: RequestInit) => {
          headersSeen.push(init?.headers as Record<string, string> | undefined);
          return new Response(
            JSON.stringify({
              model: "local",
              choices: [{ message: { content: "ok" } }],
            }),
            { status: 200 },
          );
        },
        { preconnect: () => {} },
      ) as typeof fetch;
      const client = await openOpenaiCompatible({
        baseUrl: "http://127.0.0.1:1234/v1",
        model: "local",
        fetch: fetchFn,
      });
      const result = await client.complete({
        messages: [{ role: "user", content: "hi" }],
      });
      expect(result.text).toBe("ok");
      expect(headersSeen[0]?.Authorization).toBeUndefined();
    } finally {
      if (prev !== undefined) process.env.OPENAI_API_KEY = prev;
    }
  });

  test("same driver serves Groq-shaped baseUrl + key + OpenRouter headers", async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fetchFn: typeof fetch = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        calls.push({
          url: String(input),
          headers: init?.headers as Record<string, string>,
        });
        return new Response(
          JSON.stringify({
            model: "llama-3.1-8b-instant",
            choices: [{ message: { content: "groq-ok" } }],
          }),
          { status: 200 },
        );
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    const groq = await openOpenaiCompatible({
      apiKey: "gsk-test",
      baseUrl: "https://api.groq.com/openai/v1",
      model: "llama-3.1-8b-instant",
      fetch: fetchFn,
    });
    expect((await groq.complete({ messages: [{ role: "user", content: "x" }] })).text).toBe(
      "groq-ok",
    );
    expect(calls[0]!.url).toBe("https://api.groq.com/openai/v1/chat/completions");
    expect(calls[0]!.headers.Authorization).toBe("Bearer gsk-test");

    calls.length = 0;
    const openrouter = await openOpenaiCompatible({
      apiKey: "or-test",
      baseUrl: "https://openrouter.ai/api/v1",
      model: "meta-llama/llama-3.1-8b-instruct",
      headers: {
        "HTTP-Referer": "https://example.com",
        "X-Title": "oke-test",
      },
      fetch: fetchFn,
    });
    expect((await openrouter.complete({ messages: [{ role: "user", content: "x" }] })).text).toBe(
      "groq-ok",
    );
    expect(calls[0]!.headers["HTTP-Referer"]).toBe("https://example.com");
    expect(calls[0]!.headers["X-Title"]).toBe("oke-test");
    expect(calls[0]!.headers.Authorization).toBe("Bearer or-test");
  });

  test("HTTP error fails loud (no silent mock fallback)", async () => {
    const fetchFn = Object.assign(
      async () =>
        new Response(JSON.stringify({ error: { message: "quota exceeded" } }), {
          status: 429,
        }),
      { preconnect: () => {} },
    ) as typeof fetch;
    const client = await openOpenaiCompatible({
      apiKey: "sk-test",
      baseUrl: "https://api.together.xyz/v1",
      fetch: fetchFn,
    });
    await expect(client.complete({ messages: [{ role: "user", content: "x" }] })).rejects.toThrow(
      "quota exceeded",
    );
  });
});

describe("ollama server URL helpers", () => {
  test("normalize origin and openai-compatible /v1 base", () => {
    expect(OLLAMA_DEFAULT_MODEL).toBe("qwen3.5:9b");
    expect(normalizeOllamaBaseUrl("localhost:11434")).toBe("http://localhost:11434");
    expect(normalizeOllamaBaseUrl("http://127.0.0.1:11434/v1")).toBe("http://127.0.0.1:11434");
    expect(ollamaOpenaiCompatibleBaseUrl("http://127.0.0.1:11434")).toBe(
      "http://127.0.0.1:11434/v1",
    );
  });
});
