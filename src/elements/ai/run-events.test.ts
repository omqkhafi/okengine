/**
 * Coalesced agent event log: cap, truncation, and TTL.
 */

import { describe, expect, test } from "bun:test";
import { createMemoryAgentEventStore } from "../../kernel/agent-event-store.ts";
import {
  AGENT_EVENT_CAP,
  AGENT_EVENT_TTL_MS,
  createMemoryAgentEventLog,
  setAgentEventLog,
  sweepInstalledAgentEvents,
} from "./run-events.ts";

describe("agent event log", () => {
  test("coalesces text deltas and keeps structural events", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    await log.append("r1", { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" }, 0);
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "Hel" }, 0);
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "lo" }, 0);
    await log.append("r1", { type: "TEXT_MESSAGE_END", messageId: "m-1" }, 50);
    const rows = await log.read("r1", 0);
    const content = rows.find((row) => row.event.type === "TEXT_MESSAGE_CONTENT");
    expect(content?.event).toMatchObject({ delta: "Hello" });
    expect(rows.some((row) => row.event.type === "TEXT_MESSAGE_END")).toBe(true);
  });

  test("at the cap, deltas stop and RUN_FINISHED still lands", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    for (let i = 0; i < AGENT_EVENT_CAP; i++) {
      await log.append("r1", { type: "STEP_STARTED", stepName: `step-${i}` }, i);
    }
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "x" }, 1_000);
    await log.flush("r1", 1_000);
    await log.append(
      "r1",
      {
        type: "RUN_FINISHED",
        threadId: "t1",
        runId: "r1",
        result: { cost: 0, stopReason: "completed", output: "ok" },
      },
      1_001,
    );
    const rows = await log.read("r1", 0);
    expect(rows.some((row) => row.event.type === "CUSTOM")).toBe(false);
    expect(rows.every((row) => row.event.type === "RUN_FINISHED" || row.event.type === "RUN_ERROR")).toBe(
      true,
    );
    expect(rows.at(-1)?.event.type).toBe("RUN_FINISHED");
  });

  test("sweep deletes a finished run after the TTL", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    await log.append(
      "r1",
      {
        type: "RUN_FINISHED",
        threadId: "t1",
        runId: "r1",
        result: { cost: 0, stopReason: "completed" },
      },
      10,
    );
    expect(await log.sweep(10 + AGENT_EVENT_TTL_MS - 1)).toBe(0);
    expect(await log.header("r1")).toBeDefined();
    expect(await log.sweep(10 + AGENT_EVENT_TTL_MS)).toBe(1);
    expect(await log.header("r1")).toBeUndefined();
  });

  test("sweepInstalledAgentEvents runs the scheduler hook", async () => {
    const log = createMemoryAgentEventLog();
    setAgentEventLog(log);
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    await log.append(
      "r1",
      { type: "RUN_ERROR", message: "nope", code: "Error" },
      10,
    );
    expect((await log.header("r1"))?.finishedAt).toBe(10);
    expect(await sweepInstalledAgentEvents(10 + AGENT_EVENT_TTL_MS)).toBe(1);
    setAgentEventLog(undefined);
  });

  test("100 aborted follows leave no listeners", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    const controllers = Array.from({ length: 100 }, () => new AbortController());
    const iters = controllers.map((controller) =>
      log.subscribe("r1", 0, controller.signal)[Symbol.asyncIterator](),
    );
    for (const controller of controllers) controller.abort();
    await Promise.all(iters.map((iter) => iter.next()));
    expect(log.listenerCount("r1")).toBe(0);
  });

  test("a restarted log resumes the next seq from the store", async () => {
    const store = createMemoryAgentEventStore();
    const first = createMemoryAgentEventLog(store);
    await first.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    await first.append("r1", { type: "RUN_STARTED", threadId: "t1", runId: "r1" }, 1);
    const second = createMemoryAgentEventLog(store);
    await second.open({ runId: "r1", threadId: "t1", tenant: null, gates: [], userId: null, operatorId: null });
    const seq = await second.append(
      "r1",
      { type: "RUN_FINISHED", threadId: "t1", runId: "r1", result: { cost: 0, stopReason: "completed" } },
      2,
    );
    expect(seq).toBe(2);
    expect((await second.read("r1", 0)).map((row) => row.seq)).toEqual([1, 2]);
  });
});
