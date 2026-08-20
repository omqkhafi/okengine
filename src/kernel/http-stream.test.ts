/**
 * HTTP SSE via `fx.json.stream` + client-disconnect abort of the provider fetch.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ai } from "../elements/ai.ts";
import type { AiDriver } from "../drivers/ai-types.ts";
import { createRunsRuntime } from "../runs/runtime.ts";
import { createBunRuntime } from "../runtime/bun.ts";
import type { ServerHandle } from "../runtime/types.ts";
import { oke } from "./app.ts";
import { flow, resetFlowSeq } from "./flow.ts";
import { on, resetBindings } from "./on.ts";
import { http } from "./triggers.ts";

beforeEach(() => {
  resetBindings();
  resetFlowSeq();
});

function tokenDriver(chunks: readonly string[], delayMs = 0): AiDriver {
  return {
    id: "mock",
    async open() {
      return {
        driverId: "mock" as const,
        model: "smart",
        async complete() {
          return { text: "", model: "smart", driverId: "mock" as const };
        },
        async *stream() {
          for (const text of chunks) {
            if (delayMs > 0) await new Promise((r) => setTimeout(r, delayMs));
            yield { text };
          }
        },
      };
    },
  };
}

function hangingDriver(onAbort: () => void): AiDriver {
  return {
    id: "mock",
    async open() {
      return {
        driverId: "mock" as const,
        model: "smart",
        async complete() {
          return { text: "", model: "smart", driverId: "mock" as const };
        },
        async *stream(opts) {
          yield { text: "start" };
          await new Promise<void>((resolve, reject) => {
            const t = setTimeout(resolve, 8_000);
            opts.signal?.addEventListener(
              "abort",
              () => {
                onAbort();
                clearTimeout(t);
                const err = new Error("aborted");
                err.name = "AbortError";
                reject(err);
              },
              { once: true },
            );
          });
          yield { text: "never" };
        },
      };
    },
  };
}

describe("fx.json.stream HTTP SSE", () => {
  let handle: ServerHandle | undefined;

  afterEach(() => {
    handle?.stop(true);
    handle = undefined;
  });

  test("encodes token chunks as SSE and leaves JSON flows buffered", async () => {
    const smart = ai.model("smart");
    on(
      http.get("/chat").gate.public,
      flow("chat.stream", {
        do: (_input, fx) => fx.json.stream(fx.stream(smart, { prompt: "hi" })),
      }),
    );
    on(http.get("/ping").gate.public, flow("ping", { do: () => ({ ok: true as const }) }));

    const app = oke({
      name: "http-stream",
      ai: { models: [smart], defaultDriver: tokenDriver(["Hel", "lo"]) },
    });

    const streamed = await app.fetch(new Request("http://localhost/chat"));
    expect(streamed.headers.get("content-type")).toMatch(/text\/event-stream/);
    const body = await streamed.text();
    expect(body).toContain('data: "Hel"');
    expect(body).toContain('data: "lo"');
    expect(body).toContain("data: [DONE]");

    const json = await app.fetch(new Request("http://localhost/ping"));
    expect(json.headers.get("content-type")).toMatch(/application\/json/);
    expect(await json.json()).toEqual({ data: { ok: true }, error: null });
  });

  test("client abort mid-stream aborts the upstream provider fetch", async () => {
    let providerAborted = false;
    const smart = ai.model("smart");
    on(
      http.get("/slow").gate.public,
      flow("chat.slow", {
        do: (_input, fx) => fx.json.stream(fx.stream(smart, { prompt: "long" })),
      }),
    );

    const app = oke({
      name: "http-stream-abort",
      ai: { models: [smart], defaultDriver: hangingDriver(() => (providerAborted = true)) },
    });

    handle = createBunRuntime().serve(app, { port: 0, hostname: "127.0.0.1" });
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${handle.port}/slow`, { signal: ac.signal });
    expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
    const reader = res.body!.getReader();
    const first = await reader.read();
    expect(first.done).toBe(false);
    ac.abort();
    await new Promise((r) => setTimeout(r, 80));
    expect(providerAborted).toBe(true);
  });

  test("Traces stay empty until stream close; duration covers the open stream", async () => {
    const runs = createRunsRuntime({ driver: "memory" });
    await runs.open();
    const smart = ai.model("smart");
    on(
      http.get("/chat").gate.public,
      flow("chat.stream", {
        do: (_input, fx) => fx.json.stream(fx.stream(smart, { prompt: "hi" })),
      }),
    );

    const app = oke({
      name: "http-stream-traces",
      ai: { models: [smart], defaultDriver: tokenDriver(["Hel", "lo"], 25) },
      runs,
      env: "test",
    });
    await app.boot({ env: "test", runs, startScheduler: false });

    const streamed = await app.fetch(new Request("http://localhost/chat"));
    expect(streamed.headers.get("content-type")).toMatch(/text\/event-stream/);
    await runs.flush();
    expect(await runs.all()).toHaveLength(0);

    const body = await streamed.text();
    expect(body).toContain("data: [DONE]");

    await runs.flush();
    const events = await runs.all();
    expect(events).toHaveLength(1);
    expect(events[0]!.error ?? null).toBeNull();
    expect(events[0]!.output).toEqual({ streamed: true });
    expect(events[0]!.durationMs).toBeGreaterThanOrEqual(40);

    await app.stop();
    await runs.close();
  });
});
