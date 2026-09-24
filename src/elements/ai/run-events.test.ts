/**
 * Coalesced agent event log: cap, truncation, and TTL.
 */

import { describe, expect, test } from "bun:test";
import {
  AGENT_EVENT_CAP,
  AGENT_EVENT_TTL_MS,
  createMemoryAgentEventLog,
} from "./run-events.ts";

describe("agent event log", () => {
  test("coalesces text deltas and keeps structural events", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gate: null });
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
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gate: null });
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
    expect(rows.some((row) => row.event.type === "CUSTOM" && row.event.name === "oke.events.truncated")).toBe(
      true,
    );
    expect(rows.at(-1)?.event.type).toBe("RUN_FINISHED");
  });

  test("sweep deletes a finished run after the TTL", async () => {
    const log = createMemoryAgentEventLog();
    await log.open({ runId: "r1", threadId: "t1", tenant: null, gate: null });
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
});
