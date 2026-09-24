/**
 * AG-UI agent event stream — overloads, event names, and the client import graph.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { parseAgentEvent } from "../../client/agent.ts";
import { createFx } from "../../kernel/fx.ts";
import { createJournal, createMemoryJournalStore } from "../../kernel/journal.ts";
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
  test("a non-durable approval ends with RUN_ERROR then the iterator ends", async () => {
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [
        ai.agent("support", {
          model: "smart",
          tools: [{ name: "refund", approval: true, gate: "public" }],
        }),
      ],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete() {
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              toolCalls: [{ id: "c1", name: "refund", arguments: { amount: 10 } }],
            };
          },
        },
      },
    });
    const seen: AgUiEvent[] = [];
    for await (const event of runtime.streamAgent("support", {
      message: "refund",
      flow: "assist",
    })) {
      seen.push(event);
    }
    const last = seen.at(-1);
    expect(last?.type).toBe("RUN_ERROR");
    if (last?.type === "RUN_ERROR") {
      expect(last.code).toBe("AiDurableRequiredError");
      expect(last.message).toContain("durable: true");
    }
  });

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
      expect(finished.result?.error).toBe("provider said no");
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

  test("split text and tool-call args arrive in order and replay makes no call", async () => {
    let calls = 0;
    const client = {
      driverId: "mock" as const,
      model: "smart",
      async complete() {
        calls++;
        return { text: "", model: "smart", driverId: "mock" as const };
      },
      async *stream() {
        calls++;
        yield { text: "Look" };
        yield { text: "ing." };
        yield {
          text: "",
          toolCall: { index: 0, id: "c1", name: "orders.get", argumentsDelta: "" },
        };
        yield { text: "", toolCall: { index: 0, argumentsDelta: '{"id":' } };
        yield { text: "", toolCall: { index: 0, argumentsDelta: '"14"}' } };
        yield {
          text: "",
          done: true,
          usage: { inputTokens: 3, outputTokens: 2, cost: 0.01 },
        };
      },
    };
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [ai.agent("support", { model: "smart", tools: ["orders.get"], maxSteps: 1 })],
      clients: { smart: client },
      callFlow: async () => ({ status: "open" }),
    });
    const journal = createJournal({ store: createMemoryJournalStore() });
    const session = await journal.start("assist", { message: "status" });
    const seen: AgUiEvent[] = [];
    for await (const event of runtime.streamAgent("support", {
      message: "status",
      journal: session,
    })) {
      seen.push(event);
    }
    expect(calls).toBe(1);
    const content = seen.filter((event) => event.type === "TEXT_MESSAGE_CONTENT");
    expect(
      content.map((event) => (event.type === "TEXT_MESSAGE_CONTENT" ? event.delta : "")),
    ).toEqual(["Look", "ing."]);
    const args = seen.filter((event) => event.type === "TOOL_CALL_ARGS");
    expect(args.map((event) => (event.type === "TOOL_CALL_ARGS" ? event.delta : "")).join("")).toBe(
      '{"id":"14"}',
    );
    const start = seen.find((event) => event.type === "TOOL_CALL_START");
    const textStart = seen.find((event) => event.type === "TEXT_MESSAGE_START");
    expect(start?.type === "TOOL_CALL_START" ? start.parentMessageId : undefined).toBe(
      textStart?.type === "TEXT_MESSAGE_START" ? textStart.messageId : undefined,
    );
    const resumed = await journal.resume(session.runId);
    if (!resumed) throw new Error("expected a journal resume");
    for await (const _event of runtime.streamAgent("support", {
      message: "status",
      journal: resumed,
    })) {
      // replay
    }
    expect(calls).toBe(1);
  });

  test("flow.retry keeps the agent run id", async () => {
    const client = {
      driverId: "mock" as const,
      model: "smart",
      async complete() {
        return { text: "ok", model: "smart", driverId: "mock" as const };
      },
      async *stream() {
        yield { text: "ok" };
      },
    };
    const runtime = createAiRuntime({
      models: [ai.model("smart")],
      agents: [ai.agent("support", { model: "smart", maxSteps: 1 })],
      clients: { smart: client },
    });
    const journal = createJournal({ store: createMemoryJournalStore() });
    const session = await journal.start("assist", {});
    const ids: string[] = [];
    for await (const event of runtime.streamAgent("support", { message: "hi", journal: session })) {
      if (event.type === "RUN_STARTED") ids.push(event.runId);
    }
    session.rewind();
    for await (const event of runtime.streamAgent("support", { message: "hi", journal: session })) {
      if (event.type === "RUN_STARTED") ids.push(event.runId);
    }
    const first = ids[0];
    if (!first) throw new Error("missing run id");
    expect(ids).toEqual([first, first]);
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
    expect(
      files.some((file) => file.endsWith(`${"/client/agent.ts"}`) || file.endsWith("/agent.ts")),
    ).toBe(false);
    const budget = readFileSync(resolve(root, "budget-entry.ts"), "utf8");
    expect(budget).not.toContain("client/agent");
    expect(budget).not.toContain("./agent");
  });

  test("agent and the react hook do not reach okengine/client", () => {
    const agent = walk(resolve(import.meta.dir, "../../client/agent.ts"));
    const hook = walk(resolve(import.meta.dir, "../../client-react/use-agent-run.ts"));
    const clientIndex = resolve(import.meta.dir, "../../client/index.ts");
    expect(agent.includes(clientIndex)).toBe(false);
    expect(hook.includes(clientIndex)).toBe(false);
    expect(hook.some((file) => file.endsWith("/use-agent-run.ts"))).toBe(true);
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
