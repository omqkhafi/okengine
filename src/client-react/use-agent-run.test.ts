/**
 * useAgentRun keeps one follow and does not replay text.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AiMessage } from "../drivers/ai-types.ts";
import { ai, createAiRuntime } from "../elements/ai.ts";
import { createGateRuntime, gate } from "../elements/gate.ts";
import { oke } from "../kernel/app.ts";
import { flow, resetFlowSeq, type AnyFlowDef } from "../kernel/flow.ts";
import { createMemoryJournalStore } from "../kernel/journal.ts";
import { resetBindings, type Binding } from "../kernel/on.ts";
import { http } from "../kernel/triggers.ts";
import { useAgentRun, type AgentRunState } from "./use-agent-run.ts";

function frames(rows: readonly { id: string; event: unknown }[]): string {
  return rows.map((row) => `id: ${row.id}\ndata: ${JSON.stringify(row.event)}\n\n`).join("");
}

function sse(body: string): Response {
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

describe("useAgentRun", () => {
  let happy: Window;
  let root: Root | undefined;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    happy = new Window({ url: "http://app.test/" });
    Object.defineProperty(globalThis, "window", {
      value: happy,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis, "document", {
      value: happy.document,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    root?.unmount();
    happy.close();
  });

  test("text is not duplicated and approve does not start a second follow", async () => {
    const encoder = new TextEncoder();
    let follow: ReadableStreamDefaultController<Uint8Array> | undefined;
    let lastEventId: string | null = null;
    let follows = 0;
    const fetchFn = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url.endsWith("/send")) {
          return sse(
            frames([
              { id: "1", event: { type: "RUN_STARTED", threadId: "t", runId: "run-1" } },
              { id: "2", event: { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "Hel" } },
              {
                id: "3",
                event: {
                  type: "RUN_FINISHED",
                  threadId: "t",
                  runId: "run-1",
                  outcome: {
                    type: "interrupt",
                    interrupts: [{ id: "ap-1", reason: "approval", payload: { tool: "pay" } }],
                  },
                },
              },
            ]),
          );
        }
        if (url.endsWith("/events")) {
          follows += 1;
          lastEventId = new Headers(init?.headers).get("last-event-id");
          return new Response(
            new ReadableStream({
              start(controller) {
                follow = controller;
              },
            }),
            { status: 200, headers: { "content-type": "text/event-stream" } },
          );
        }
        follow?.enqueue(
          encoder.encode(
            frames([
              { id: "4", event: { type: "TEXT_MESSAGE_CONTENT", messageId: "m", delta: "lo" } },
              {
                id: "5",
                event: {
                  type: "RUN_FINISHED",
                  threadId: "t",
                  runId: "run-1",
                  result: { cost: 0, stopReason: "completed", output: "Hello" },
                },
              },
            ]),
          ),
        );
        follow?.close();
        return new Response(JSON.stringify({ data: { ok: true }, error: null }), { status: 200 });
      },
      { preconnect: () => undefined },
    ) as typeof fetch;

    let view: AgentRunState | undefined;
    function Probe(): null {
      const state = useAgentRun({
        sendUrl: "http://app.test/send",
        approveUrl: "http://app.test/approve",
        denyUrl: "http://app.test/deny",
        followUrl: (runId) => `http://app.test/runs/${runId}/events`,
        fetch: fetchFn,
      });
      useEffect(() => {
        view = state;
      });
      view = state;
      return null;
    }

    root = createRoot(happy.document.createElement("div"));
    await act(async () => {
      root?.render(createElement(Probe));
    });
    await act(async () => {
      await view?.send("hi");
    });
    expect(view?.status).toBe("approval");
    expect(view?.text).toBe("Hel");
    await act(async () => {
      await view?.approve();
    });
    const start = Date.now();
    while (view?.text !== "Hello") {
      if (Date.now() - start > 1_000) throw new Error(`text stayed ${view?.text}`);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
      });
    }
    expect(view?.text).toBe("Hello");
    expect(follows).toBe(1);
    if (lastEventId !== "3") throw new Error(`last event id ${String(lastEventId)}`);
  });

  test("a booted app shows the model text once across a real approval", async () => {
    const calls: unknown[] = [];
    const store = createMemoryJournalStore();
    const ops = gate.policy("ops", () => true);
    const runtime = createAiRuntime({
      journalStore: store,
      models: [ai.model("smart")],
      gates: createGateRuntime({ gates: [ops] }),
      agents: [
        ai.agent("support", {
          model: "smart",
          maxSteps: 4,
          tools: [{ name: "refund", approval: true, gate: "ops", timeout: "1h" }],
        }),
      ],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return { text: "", raw: {}, model: "smart", driverId: "mock" as const };
          },
          async *stream(opts: { messages: readonly AiMessage[] }) {
            const answered = opts.messages.some((message) => message.role === "tool");
            if (!answered) {
              yield { text: "Hello" };
              yield {
                text: "",
                toolCall: { index: 0, id: "tc1", name: "refund", argumentsDelta: "{}" },
              };
              yield { text: "", done: true as const };
              return;
            }
            yield { text: "!" };
            yield { text: "", done: true as const };
          },
        },
      },
    });
    const refund = flow("refund", {
      do: async (input) => {
        calls.push(input);
        return { refunded: true };
      },
    });
    const assist: Binding = {
      trigger: http.post("/assist"),
      flow: flow("assist", {
        durable: true,
        effects: { asks: ["support"], calls: ["refund"] },
        do: (_input, fx) =>
          fx.json.stream(fx.run("support", { message: "refund" }, { stream: true })),
      }) as AnyFlowDef,
    };
    resetBindings();
    const app = oke({
      name: "use-agent-run",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      gate: { unguardedHttp: "allow", policies: [ops] },
      bindings: [assist, { trigger: http.post("/refund"), flow: refund as AnyFlowDef }],
      elements: {
        journal: { store, instanceId: "use-agent-run", leaseMs: 30_000, driverId: "memory" },
        ai: runtime,
      },
    });
    await app.boot({ env: "test" });
    const fetchFn = Object.assign(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(String(input), init);
        return app.fetch(request);
      },
      { preconnect: () => undefined },
    ) as typeof fetch;

    let view: AgentRunState | undefined;
    function Probe(): null {
      const state = useAgentRun({
        sendUrl: "http://localhost/assist",
        approveUrl: "http://localhost/agent/approvals/approve",
        denyUrl: "http://localhost/agent/approvals/deny",
        followUrl: (runId) => `http://localhost/agent/runs/${runId}/events`,
        fetch: fetchFn,
      });
      useEffect(() => {
        view = state;
      });
      view = state;
      return null;
    }

    root = createRoot(happy.document.createElement("div"));
    await act(async () => {
      root?.render(createElement(Probe));
    });
    await act(async () => {
      await view?.send("refund");
    });
    expect(view?.status).toBe("approval");
    expect(view?.text).toBe("Hello");
    await act(async () => {
      await view?.approve();
    });
    await app.resumeDurable(Date.now() + 1000);
    const start = Date.now();
    while (view?.text !== "Hello!") {
      if (Date.now() - start > 3_000) throw new Error(`text stayed ${view?.text}`);
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    expect(view?.text).toBe("Hello!");
    expect(calls).toEqual([{}]);
    await app.bootResult?.close();
    resetBindings();
    resetFlowSeq();
  });
});
