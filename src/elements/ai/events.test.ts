/**
 * AG-UI agent event stream — overloads, event names, and the client import graph.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseAgentEvent } from "../../client/agent.ts";
import { createFx } from "../../kernel/fx.ts";
import { ai, createAiRuntime, type AgUiEvent } from "../ai.ts";

describe("fx.run stream overload", () => {
  test("stream: true is an async iterable of AG-UI events", async () => {
    const fx = createFx({
      flow: "support.assist",
      effects: { asks: ["support"] },
    });
    const events = fx.run("support", { message: "hi" }, { stream: true });
    const typed: AsyncIterable<AgUiEvent> = events;
    expect(typeof typed[Symbol.asyncIterator]).toBe("function");
    const plain = fx.run("support", { message: "hi" });
    expect(plain).toBeInstanceOf(Promise);
    await expect(plain).resolves.toMatchObject({ ok: true });
  });
});

describe("fx.run messages", () => {
  test("history is sent to the model and both fields throw", async () => {
    let seen = "";
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [ai.agent("support", { model: "smart", tools: [], maxSteps: 1 })],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete(opts) {
            seen = opts.messages.map((message) => message.content).join("|");
            return { text: "ok", raw: {}, model: "smart", driverId: "mock" };
          },
        },
      },
    });
    const result = await runtime.runAgent("support", {
      messages: [
        { role: "user", content: "first" },
        { role: "assistant", content: "ack" },
        { role: "user", content: "second" },
      ],
    });
    expect(result.stopReason).toBe("completed");
    expect(seen).toBe("first|ack|second");
    await expect(
      runtime.runAgent("support", { message: "a", messages: [{ role: "user", content: "b" }] }),
    ).rejects.toThrow(/message or messages/);
  });
});

describe("agent event stream", () => {
  test("a thrown tool ends with RUN_FINISHED stopReason error", async () => {
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [ai.agent("support", { model: "smart", tools: ["orders.get"], maxSteps: 2 })],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return {
              text: "",
              raw: { provider: "raw" },
              model: "smart",
              driverId: "mock",
              toolCalls: [{ id: "c1", name: "orders.get", arguments: {} }],
            };
          },
        },
      },
      callFlow: async () => {
        throw new Error("provider said no");
      },
    });
    const seen: AgUiEvent[] = [];
    for await (const event of runtime.streamAgent("support", { message: "status" })) {
      seen.push(event);
    }
    const finished = seen.at(-1);
    expect(finished?.type).toBe("RUN_FINISHED");
    if (finished?.type === "RUN_FINISHED") {
      expect(finished.result?.stopReason).toBe("error");
    }
  });

  test("a tool call yields AG-UI events and RUN_FINISHED.result", async () => {
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [ai.agent("support", { model: "smart", tools: ["orders.get"], maxSteps: 1 })],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return {
              text: "Looking up.",
              raw: {},
              model: "smart",
              driverId: "mock",
              usage: { inputTokens: 3, outputTokens: 2, cost: 0.01 },
              toolCalls: [{ id: "c1", name: "orders.get", arguments: { id: "14" } }],
            };
          },
        },
      },
      callFlow: async () => ({ status: "open" }),
    });
    const seen: string[] = [];
    let finished: AgUiEvent | undefined;
    for await (const event of runtime.streamAgent("support", { message: "status" })) {
      seen.push(event.type);
      if (event.type === "RUN_FINISHED") finished = event;
    }
    expect(seen[0]).toBe("RUN_STARTED");
    expect(seen).toContain("TEXT_MESSAGE_CONTENT");
    expect(seen).toContain("TOOL_CALL_START");
    expect(seen).toContain("TOOL_CALL_ARGS");
    expect(seen).toContain("TOOL_CALL_RESULT");
    expect(seen.at(-1)).toBe("RUN_FINISHED");
    expect(finished?.type).toBe("RUN_FINISHED");
    if (finished?.type === "RUN_FINISHED") {
      expect(finished.result?.stopReason).toBe("max_steps");
      expect(finished.result?.cost).toBe(0.01);
      expect(finished.usage).toEqual([{ inputTokens: 3, outputTokens: 2 }]);
    }
  });
});

describe("client agent parser", () => {
  test("CUSTOM subagent names become typed variants and other CUSTOM stays", () => {
    const started = parseAgentEvent({
      type: "CUSTOM",
      name: "oke.subagent.started",
      value: { runId: "child-1", parentToolCallId: "c1" },
    });
    expect(started).toEqual({
      type: "subagent.started",
      runId: "child-1",
      parentToolCallId: "c1",
    });
    const custom = parseAgentEvent({ type: "CUSTOM", name: "other", value: { a: 1 } });
    expect(custom).toMatchObject({ type: "CUSTOM", name: "other" });
  });
});

describe("okengine/client import graph", () => {
  test("the core client entry does not import client/agent", () => {
    const root = resolve(import.meta.dir, "../../client");
    const files = walk(resolve(root, "index.ts"));
    expect(files.some((file) => file.endsWith(`${"/client/agent.ts"}`) || file.endsWith("/agent.ts"))).toBe(
      false,
    );
    const budget = readFileSync(resolve(root, "budget-entry.ts"), "utf8");
    expect(budget).not.toContain("client/agent");
    expect(budget).not.toContain("./agent");
  });
});

function walk(file: string, seen = new Set<string>()): string[] {
  if (seen.has(file)) return [];
  seen.add(file);
  const text = readFileSync(file, "utf8");
  const specs = [...text.matchAll(/from "(\.[^"]+)"/g)].map((match) => match[1] ?? "");
  const out = [file];
  for (const spec of specs) {
    if (!spec) continue;
    let next = resolve(dirname(file), spec);
    if (!next.endsWith(".ts")) next += ".ts";
    out.push(...walk(next, seen));
  }
  return out;
}
