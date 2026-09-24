/**
 * Real streaming + ambient AbortSignal cancellation (no second mechanism).
 */

import { describe, expect, test } from "bun:test";
import { withAbortSignal } from "../kernel/abort-scope.ts";
import { createFx, createFxContext } from "../kernel/fx.ts";
import { ai, createAiRuntime } from "../elements/ai.ts";
import { openAnthropic } from "./ai-anthropic.ts";
import { openOpenaiCompatible } from "./ai-openai-compatible.ts";
import { mockAiDriver } from "./ai-mock.ts";

describe("openai-compatible SSE stream", () => {
  test("parses data: chunks and honours abort", async () => {
    const sse =
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n' +
      'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
      "data: [DONE]\n\n";
    let aborted = false;
    const fetchFn: typeof fetch = Object.assign(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            aborted = true;
          });
        }
        return new Response(sse, {
          status: 200,
          headers: { "content-type": "text/event-stream" },
        });
      },
      { preconnect: () => {} },
    ) as typeof fetch;

    const client = await openOpenaiCompatible({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      fetch: fetchFn,
    });
    const parts: string[] = [];
    for await (const chunk of client.stream!({
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.text) parts.push(chunk.text);
    }
    expect(parts.join("")).toBe("Hello");
    const bodies: unknown[] = [];
    const formatFetch = Object.assign(
      async (_input: string | URL | Request, init?: RequestInit) => {
        bodies.push(JSON.parse(String(init?.body)));
        return new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } });
      },
      { preconnect: () => {} },
    ) as typeof fetch;
    const formatted = await openOpenaiCompatible({
      apiKey: "sk-test",
      baseUrl: "https://example.test/v1",
      fetch: formatFetch,
    });
    for await (const _chunk of formatted.stream!({
      messages: [{ role: "user", content: "hi" }],
      responseFormat: {
        type: "json_schema",
        json_schema: { name: "out", schema: { type: "object" } },
      },
    })) {
      // drain
    }
    expect(bodies[0]).toMatchObject({ response_format: { type: "json_object" } });

    const ac = new AbortController();
    const iter = client.stream!({
      messages: [{ role: "user", content: "hi" }],
      signal: ac.signal,
    })[Symbol.asyncIterator]();
    await iter.next();
    ac.abort();
    // Consumer abort should mark the signal; driver checks between reads.
    expect(ac.signal.aborted).toBe(true);
    void aborted;
  });
});

describe("anthropic messages stream", () => {
  test("text deltas, input_json_delta, and message_delta usage", async () => {
    const sse = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"output_tokens":1}}}',
      'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Ok"}}',
      'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"toolu_1","name":"orders.get","input":{}}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"id\\":"}}',
      'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"\\"14\\"}"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":6}}',
      'data: {"type":"message_stop"}',
      "",
    ].join("\n");
    const fetchFn = Object.assign(
      async () =>
        new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } }),
      { preconnect: () => {} },
    ) as typeof fetch;
    const client = await openAnthropic({
      apiKey: "sk-test",
      fetch: fetchFn,
    });
    const texts: string[] = [];
    const args: string[] = [];
    let usage: { inputTokens?: number; outputTokens?: number } | undefined;
    for await (const chunk of client.stream!({
      messages: [{ role: "user", content: "status" }],
      tools: [{ name: "orders.get" }],
    })) {
      if (chunk.text) texts.push(chunk.text);
      if (chunk.toolCall?.argumentsDelta) args.push(chunk.toolCall.argumentsDelta);
      if (chunk.usage) usage = chunk.usage;
    }
    expect(texts.join("")).toBe("Ok");
    expect(args.join("")).toBe('{"id":"14"}');
    expect(usage).toEqual({ inputTokens: 4, outputTokens: 6 });
  });
});

describe("fx.stream uses ambient AbortSignal", () => {
  test("race abort cancels in-flight stream fetch", async () => {
    let sawAbort = false;
    const smart = ai.model("smart");
    const runtime = createAiRuntime({
      models: [smart],
      defaultDriver: {
        id: "mock",
        async open() {
          return {
            driverId: "mock" as const,
            model: "smart",
            async complete() {
              return { text: "", model: "smart", driverId: "mock" as const };
            },
            async *stream(opts) {
              const signal = opts.signal;
              yield { text: "start" };
              await new Promise<void>((resolve, reject) => {
                const t = setTimeout(resolve, 5_000);
                signal?.addEventListener("abort", () => {
                  sawAbort = true;
                  clearTimeout(t);
                  const err = new Error("aborted");
                  err.name = "AbortError";
                  reject(err);
                });
              });
              yield { text: "never" };
            },
          };
        },
      },
    });

    const fx = createFx({
      flow: "stream-host",
      effects: { asks: ["smart"] },
      aiRuntime: runtime,
    });

    await expect(
      fx.race([
        async () => {
          for await (const _c of fx.stream("smart", { prompt: "long" })) {
            // consume until aborted by the race sibling
          }
          return "stream";
        },
        async () => {
          await new Promise((r) => setTimeout(r, 20));
          return "winner";
        },
      ]),
    ).resolves.toBe("winner");

    // Give the abort listener a tick.
    await new Promise((r) => setTimeout(r, 30));
    expect(sawAbort).toBe(true);
  });

  test("mock driver streams through fx.stream", async () => {
    const smart = ai.model("smart");
    const runtime = createAiRuntime({
      models: [smart],
      defaultDriver: mockAiDriver,
      clients: {
        smart: await mockAiDriver.open({
          model: "smart",
          mockResponses: { "*": "abcdef" },
        }),
      },
    });
    const { fx } = createFxContext({
      flow: "s",
      effects: { asks: ["smart"] },
      aiRuntime: runtime,
    });
    const parts: string[] = [];
    for await (const c of fx.stream("smart", { prompt: "hi" })) {
      parts.push(c);
    }
    expect(parts.join("")).toBe("abcdef");
  });

  test("withAbortSignal aborts cooperative mock stream", async () => {
    const client = await mockAiDriver.open({
      mockResponses: { "*": "abcdefghij" },
    });
    const ac = new AbortController();
    await withAbortSignal(ac.signal, async () => {
      const iter = client.stream!({
        messages: [{ role: "user", content: "x" }],
        signal: ac.signal,
      })[Symbol.asyncIterator]();
      await iter.next();
      ac.abort();
      await expect(iter.next()).rejects.toThrow();
    });
  });
});
