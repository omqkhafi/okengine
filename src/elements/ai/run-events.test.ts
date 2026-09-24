/**
 * Coalesced agent event log: cap, truncation, and TTL.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  AgentEventDuplicateSeqError,
  createFileAgentEventStore,
  createMemoryAgentEventStore,
  createPostgresAgentEventStore,
} from "../../kernel/agent-event-store.ts";
import { connectPglite } from "../../drivers/pglite.ts";
import {
  AGENT_EVENT_CAP,
  AGENT_EVENT_TTL_MS,
  createMemoryAgentEventLog,
  setAgentEventLog,
  sweepInstalledAgentEvents,
} from "./run-events.ts";

const header = {
  runId: "r1",
  threadId: "t1",
  tenant: null,
  gates: [] as string[],
  userId: null,
  operatorId: null,
};

describe("agent event log", () => {
  test("the default cap is 5000 rows", () => {
    expect(AGENT_EVENT_CAP).toBe(5_000);
  });

  test("coalesces text deltas and keeps structural events", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
    await log.append("r1", { type: "TEXT_MESSAGE_START", messageId: "m-1", role: "assistant" }, 0);
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "Hel" }, 0);
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "lo" }, 0);
    await log.append("r1", { type: "TEXT_MESSAGE_END", messageId: "m-1" }, 50);
    const rows = await log.read("r1", 0);
    const content = rows.find((row) => row.event.type === "TEXT_MESSAGE_CONTENT");
    expect(content?.event).toMatchObject({ delta: "Hello" });
    expect(rows.some((row) => row.event.type === "TEXT_MESSAGE_END")).toBe(true);
  });

  test("at the cap, deltas stop and structural events stay", async () => {
    const log = createMemoryAgentEventLog(undefined, { cap: 3 });
    await log.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
    for (let i = 0; i < 3; i++) {
      await log.append("r1", { type: "STEP_STARTED", stepName: `step-${i}` }, i);
    }
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "x" }, 1_000);
    await log.flush("r1", 1_000);
    await log.append("r1", { type: "TEXT_MESSAGE_CONTENT", messageId: "m-1", delta: "y" }, 1_000);
    await log.append("r1", { type: "STEP_STARTED", stepName: "after" }, 1_001);
    await log.append(
      "r1",
      {
        type: "RUN_FINISHED",
        threadId: "t1",
        runId: "r1",
        outcome: {
          type: "interrupt",
          interrupts: [{ id: "ap-1", reason: "approval" }],
        },
      },
      1_002,
    );
    await log.append(
      "r1",
      {
        type: "RUN_FINISHED",
        threadId: "t1",
        runId: "r1",
        result: { cost: 0, stopReason: "completed", output: "ok" },
      },
      1_003,
    );
    const rows = await log.read("r1", 0);
    expect(rows.map((row) => row.seq)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(rows.filter((row) => row.event.type === "CUSTOM")).toHaveLength(1);
    expect(rows.some((row) => row.event.type === "TEXT_MESSAGE_CONTENT")).toBe(false);
    expect(
      rows.some((row) => row.event.type === "STEP_STARTED" && row.event.stepName === "after"),
    ).toBe(true);
    expect(rows.at(-2)?.event.type).toBe("RUN_FINISHED");
    expect(rows.at(-1)?.event.type).toBe("RUN_FINISHED");
  });

  test("sweep deletes a finished run after the TTL", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
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
    await log.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
    await log.append("r1", { type: "RUN_ERROR", message: "nope", code: "Error" }, 10);
    expect((await log.header("r1"))?.finishedAt).toBe(10);
    expect(await sweepInstalledAgentEvents(10 + AGENT_EVENT_TTL_MS)).toBe(1);
    setAgentEventLog(undefined);
  });

  test("100 aborted follows leave no listeners", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
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
    await first.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
    await first.append("r1", { type: "RUN_STARTED", threadId: "t1", runId: "r1" }, 1);
    const second = createMemoryAgentEventLog(store);
    await second.open({
      runId: "r1",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
    const seq = await second.append(
      "r1",
      {
        type: "RUN_FINISHED",
        threadId: "t1",
        runId: "r1",
        result: { cost: 0, stopReason: "completed" },
      },
      2,
    );
    expect(seq).toBe(2);
    expect((await second.read("r1", 0)).map((row) => row.seq)).toEqual([1, 2]);
  });

  test("sweep reads the store, and an abandoned run is closed then removed", async () => {
    const store = createMemoryAgentEventStore();
    const first = createMemoryAgentEventLog(store);
    await first.open({
      runId: "done",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
    });
    await first.append(
      "done",
      {
        type: "RUN_FINISHED",
        threadId: "t1",
        runId: "done",
        result: { cost: 0, stopReason: "completed" },
      },
      10,
    );
    await first.open({
      runId: "stuck",
      threadId: "t1",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
      openedAt: 10,
    });
    const second = createMemoryAgentEventLog(store, { maxAgeMs: 50 });
    expect(second.listenerCount("done")).toBe(0);
    expect(await second.sweep(10 + AGENT_EVENT_TTL_MS, AGENT_EVENT_TTL_MS, 50)).toBe(2);
    expect(await second.header("done")).toBeUndefined();
    expect(await second.header("stuck")).toBeUndefined();
  });

  test("a duplicate seq is an error", async () => {
    const store = createMemoryAgentEventStore();
    await store.writeHeader(header);
    await store.append("r1", { seq: 1, event: { type: "RUN_STARTED" } });
    await expect(
      store.append("r1", { seq: 1, event: { type: "RUN_STARTED" } }),
    ).rejects.toBeInstanceOf(AgentEventDuplicateSeqError);
  });

  test("a file store appends JSONL under a write lock", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-events-"));
    const store = createFileAgentEventStore(dir);
    const log = createMemoryAgentEventLog(store);
    await log.open(header);
    await Promise.all([
      log.append("r1", { type: "STEP_STARTED", stepName: "a" }, 1),
      log.append("r1", { type: "STEP_STARTED", stepName: "b" }, 2),
    ]);
    const text = await Bun.file(join(dir, `${encodeURIComponent("r1")}.jsonl`)).text();
    const lines = text.trim().split("\n");
    expect(lines[0]).toContain('"kind":"header"');
    expect(lines.filter((line) => line.includes('"kind":"row"'))).toHaveLength(2);
    expect((await log.read("r1", 0)).map((row) => row.seq)).toEqual([1, 2]);
  });

  test("PGlite stores interleaved emits in call order", async () => {
    const sql = await connectPglite({ url: "memory://" });
    try {
      const store = await createPostgresAgentEventStore(sql);
      const log = createMemoryAgentEventLog(store);
      await log.open(header);
      const names: string[] = [];
      const writes = [];
      for (let i = 0; i < 20; i++) {
        const stepName = i % 2 === 0 ? `a-${i}` : `b-${i}`;
        names.push(stepName);
        writes.push(log.append("r1", { type: "STEP_STARTED", stepName }, i));
      }
      await Promise.all(writes);
      const rows = await log.read("r1", 0);
      expect(
        rows.map((row) => (row.event.type === "STEP_STARTED" ? row.event.stepName : "")),
      ).toEqual(names);
      expect(rows.map((row) => row.seq)).toEqual(names.map((_, index) => index + 1));
    } finally {
      await sql.close();
    }
  });

  test("resume on another log continues seq without rewriting", async () => {
    const sql = await connectPglite({ url: "memory://" });
    try {
      const store = await createPostgresAgentEventStore(sql);
      const first = createMemoryAgentEventLog(store);
      await first.open(header);
      await first.append("r1", { type: "RUN_STARTED", threadId: "t1", runId: "r1" }, 1);
      await first.append(
        "r1",
        {
          type: "RUN_FINISHED",
          threadId: "t1",
          runId: "r1",
          outcome: { type: "interrupt", interrupts: [{ id: "ap-1", reason: "approval" }] },
        },
        2,
      );
      const second = createMemoryAgentEventLog(store);
      await second.open(header);
      await second.append("r1", { type: "STEP_STARTED", stepName: "after" }, 3);
      await second.append(
        "r1",
        {
          type: "RUN_FINISHED",
          threadId: "t1",
          runId: "r1",
          result: { cost: 0, stopReason: "completed" },
        },
        4,
      );
      const rows = await store.read("r1");
      expect(rows?.rows.map((row) => row.seq)).toEqual([1, 2, 3, 4]);
      expect(new Set(rows?.rows.map((row) => row.seq)).size).toBe(4);
    } finally {
      await sql.close();
    }
  });
});
