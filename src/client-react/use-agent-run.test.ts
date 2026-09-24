/**
 * useAgentRun keeps one follow and does not replay text.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
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
});
