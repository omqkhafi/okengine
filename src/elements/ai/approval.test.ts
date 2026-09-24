/**
 * Durable tool approval — park, first resolution wins, resume replays the tool.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { AiMessage } from "../../drivers/ai-types.ts";
import { flow, resetFlowSeq, type AnyFlowDef } from "../../kernel/flow.ts";
import { createJournal, createMemoryJournalStore, isJournalSuspend } from "../../kernel/journal.ts";
import type { JournalSession } from "../../kernel/journal.ts";
import { oke, type OkeApp } from "../../kernel/app.ts";
import { resetBindings, type Binding } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { ai, createAiRuntime, type AiRuntime } from "../ai.ts";
import {
  createPostgresJournalFake,
  createPostgresJournalStore,
} from "../../drivers/journal-postgres.ts";
import { parseApprovalId, readAgentApproval, resolveAgentApproval } from "./approval.ts";
import { createGateRuntime, gate } from "../gate.ts";

const apps: OkeApp[] = [];

afterEach(async () => {
  resetBindings();
  resetFlowSeq();
  for (const app of apps) await app.bootResult?.close();
  apps.length = 0;
});

function model(seen: AiMessage[][], toolCallId = "tc1") {
  return {
    driverId: "mock" as const,
    model: "smart",
    async complete(opts: { messages: readonly AiMessage[] }) {
      seen.push([...opts.messages]);
      const answered = opts.messages.some((message) => message.role === "tool");
      if (answered) {
        return { text: "done", raw: {}, model: "smart", driverId: "mock" as const };
      }
      return {
        text: "",
        raw: {},
        model: "smart",
        driverId: "mock" as const,
        toolCalls: [{ id: toolCallId, name: "refund", arguments: { amount: 10 } }],
      };
    },
  };
}

function runtime(opts: {
  readonly seen: AiMessage[][];
  readonly calls: unknown[];
  readonly store: ReturnType<typeof createMemoryJournalStore>;
  readonly now: () => number;
  readonly approval?: boolean | ((input: unknown) => boolean);
  readonly allow?: boolean;
  readonly toolCallId?: string;
}): AiRuntime {
  const ops = gate.policy("ops", () => opts.allow !== false);
  return createAiRuntime({
    now: opts.now,
    journalStore: opts.store,
    models: [ai.model("smart")],
    gates: createGateRuntime({ gates: [ops] }),
    agents: [
      ai.agent("support", {
        model: "smart",
        maxSteps: 4,
        tools: [
          {
            name: "refund",
            approval: opts.approval ?? true,
            gate: "ops",
            timeout: "1h",
          },
        ],
      }),
    ],
    clients: { smart: model(opts.seen, opts.toolCallId) },
    callFlow: async (_name, input) => {
      opts.calls.push(input);
      return { refunded: true };
    },
  });
}

function parkedId(session: JournalSession): string {
  const entry = session.run.entries.find(
    (item) => item.kind === "step" && item.name.startsWith("ai-approval:"),
  );
  if (!entry || entry.kind !== "step") throw new Error("expected a pending approval");
  return entry.name.slice("ai-approval:".length);
}

async function park(aiRuntime: AiRuntime, session: JournalSession): Promise<void> {
  try {
    await aiRuntime.runAgent("support", {
      message: "refund",
      journal: session,
      flow: "assist",
    });
    throw new Error("expected suspend");
  } catch (err) {
    if (!isJournalSuspend(err)) throw err;
  }
}

describe("durable tool approval", () => {
  test("approve, edited args, 409, and resume does not call the tool twice", async () => {
    const seen: AiMessage[][] = [];
    const calls: unknown[] = [];
    const store = createMemoryJournalStore();
    const now = () => 1_000_000;
    const aiRuntime = runtime({ seen, calls, store, now });
    const journal = createJournal({ store, now });
    const session = await journal.start("assist", { message: "refund" });
    await park(aiRuntime, session);

    const id = parkedId(session);
    const pending = await readAgentApproval(store, id);
    expect(pending?.status).toBe("pending");
    expect(pending?.tool).toBe("refund");

    const approved = await resolveAgentApproval(
      store,
      id,
      { decision: "approve", args: { amount: 4 }, approver: "sam", tenant: null },
      now,
    );
    expect(approved).toEqual({ ok: true });
    expect(
      await resolveAgentApproval(store, id, { decision: "deny", tenant: null }, now),
    ).toEqual({ ok: false, status: 409, reason: "resolved" });

    const resumed = await journal.resume(session.runId);
    const result = await aiRuntime.runAgent("support", {
      message: "refund",
      journal: resumed,
      flow: "assist",
    });
    expect(result.stopReason).toBe("completed");
    expect(calls).toEqual([{ amount: 4 }]);
    expect(result.trail[0]?.approver).toBe("sam");

    const again = await journal.resume(session.runId);
    await aiRuntime.runAgent("support", {
      message: "refund",
      journal: again,
      flow: "assist",
    });
    expect(calls).toEqual([{ amount: 4 }]);
  });

  test("deny feeds the reason to the model and does not set stopReason denied", async () => {
    const seen: AiMessage[][] = [];
    const calls: unknown[] = [];
    const store = createMemoryJournalStore();
    const now = () => 1_000_000;
    const aiRuntime = runtime({ seen, calls, store, now });
    const journal = createJournal({ store, now });
    const session = await journal.start("assist", {});
    await park(aiRuntime, session);
    await resolveAgentApproval(
      store,
      parkedId(session),
      { decision: "deny", reason: "over the limit", tenant: null },
      now,
    );
    const resumed = await journal.resume(session.runId);
    const result = await aiRuntime.runAgent("support", {
      message: "refund",
      journal: resumed,
      flow: "assist",
    });
    expect(calls).toEqual([]);
    expect(result.stopReason).toBe("completed");
    const tool = seen.flat().find((message) => message.role === "tool");
    expect(tool?.content).toContain("over the limit");
  });

  test("timeout denies and a new journal still sees a pending row before it", async () => {
    const seen: AiMessage[][] = [];
    const calls: unknown[] = [];
    let clock = 5_000_000;
    const store = createMemoryJournalStore();
    const aiRuntime = runtime({ seen, calls, store, now: () => clock });
    const journal = createJournal({ store, now: () => clock });
    const session = await journal.start("assist", {});
    await park(aiRuntime, session);

    const restarted = createJournal({ store, now: () => clock });
    expect((await readAgentApproval(restarted.store, parkedId(session)))?.status).toBe("pending");

    clock += 60 * 60 * 1000 + 1;
    const resumed = await restarted.resume(session.runId);
    const result = await aiRuntime.runAgent("support", {
      message: "refund",
      journal: resumed,
      flow: "assist",
    });
    expect(calls).toEqual([]);
    expect(result.stopReason).toBe("completed");
    const tool = seen.flat().find((message) => message.role === "tool");
    expect(tool?.content).toContain("timeout");
  });

  test("a non-durable caller is refused and a false predicate does not park", async () => {
    const seen: AiMessage[][] = [];
    const calls: unknown[] = [];
    const store = createMemoryJournalStore();
    const aiRuntime = runtime({ seen, calls, store, now: () => 1 });
    await expect(
      aiRuntime.runAgent("support", { message: "refund", flow: "assist" }),
    ).rejects.toThrow(/assist.*durable: true/);

    const open = runtime({
      seen,
      calls,
      store,
      now: () => 1,
      approval: () => false,
    });
    const result = await open.runAgent("support", { message: "refund", flow: "assist" });
    expect(result.stopReason).toBe("completed");
    expect(calls).toEqual([{ amount: 10 }]);
  });

  test("a denying gate is 403 and a mismatched tenant is 404", async () => {
    const store = createMemoryJournalStore();
    const now = () => 1;
    const aiRuntime = runtime({ seen: [], calls: [], store, now, allow: false });
    const journal = createJournal({ store, now });
    const session = await journal.start("assist", {});
    await park(aiRuntime, session);
    const ctx = {
      auth: { userId: null, scopes: new Set<string>() },
      operator: { id: null },
    };
    expect(
      await aiRuntime.resolveApproval(parkedId(session), { decision: "approve", tenant: null }, ctx),
    ).toEqual({
      ok: false,
      status: 403,
    });
    const pendingId = parkedId(session);
    expect((await readAgentApproval(store, pendingId))?.status).toBe("pending");
    const allowed = runtime({ seen: [], calls: [], store, now });
    expect(
      await allowed.resolveApproval(pendingId, { decision: "approve", tenant: "other" }, ctx),
    ).toEqual({ ok: false, status: 404 });
  });
});

describe("approval http", () => {
  test("approve is gated, idempotent, and a later decision is 409", async () => {
    const calls: unknown[] = [];
    const store = createMemoryJournalStore();
    const ops = gate.policy("ops", () => true);
    const aiRuntime = createAiRuntime({
      journalStore: store,
      models: [ai.model("smart")],
      gates: createGateRuntime({ gates: [ops] }),
      agents: [
        ai.agent("support", {
          model: "smart",
          maxSteps: 4,
          tools: [{ name: "refund", approval: true, gate: "ops" }],
        }),
      ],
      clients: {
        smart: {
          driverId: "mock",
          model: "smart",
          async complete(opts) {
            if (opts.messages.some((message) => message.role === "tool")) {
              return { text: "done", raw: {}, model: "smart", driverId: "mock" };
            }
            return {
              text: "",
              raw: {},
              model: "smart",
              driverId: "mock",
              toolCalls: [{ id: "tc1", name: "refund", arguments: { amount: 10 } }],
            };
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
        do: async (_input, fx) => fx.run("support", { message: "refund" }),
      }) as AnyFlowDef,
    };
    resetBindings();
    const app = oke({
      name: "approval-http",
      env: "test",
      startScheduler: false,
      registry: "ignore",
      gate: { unguardedHttp: "allow", policies: [ops] },
      bindings: [assist, { trigger: http.post("/refund"), flow: refund as AnyFlowDef }],
      elements: {
        journal: { store, instanceId: "approval-test", leaseMs: 30_000, driverId: "memory" },
        ai: aiRuntime,
      },
    });
    await app.boot({ env: "test" });
    apps.push(app);

    const parked = await app.fetch(
      new Request("http://localhost/assist", { method: "POST", body: "{}" }),
    );
    expect(parked.status).toBeLessThan(500);
    const runs = await store.list();
    const step = runs
      .flatMap((run) => run.entries)
      .find((entry) => entry.kind === "step" && entry.name.startsWith("ai-approval:"));
    if (!step || step.kind !== "step") throw new Error("expected a pending approval");
    const id = step.name.slice("ai-approval:".length);
    expect((await readAgentApproval(store, id))?.status).toBe("pending");

    const key = "approval-key-0001";
    const first = await app.fetch(
      new Request("http://localhost/agent/approvals/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({ id, args: { amount: 4 } }),
      }),
    );
    expect(first.status).toBe(200);

    const replay = await app.fetch(
      new Request("http://localhost/agent/approvals/approve", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "idempotency-key": key,
        },
        body: JSON.stringify({ id, args: { amount: 4 } }),
      }),
    );
    expect(replay.status).toBe(200);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");

    const conflict = await app.fetch(
      new Request("http://localhost/agent/approvals/deny", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id, reason: "late" }),
      }),
    );
    expect(conflict.status).toBe(409);
    expect(conflict.headers.get("retry-after")).toBeNull();
    const conflictBody = (await conflict.json()) as { error: { code: string } };
    expect(conflictBody.error.code).toBe("Conflict");

    await app.resumeDurable(Date.now() + 1000);
    expect(calls).toEqual([{ amount: 4 }]);
    await app.resumeDurable(Date.now() + 1000);
    expect(calls).toEqual([{ amount: 4 }]);
  }, 20_000);
});

describe("approval ids", () => {
  test("two runs with the same tool call id resolve independently", async () => {
    const seen: AiMessage[][] = [];
    const store = createMemoryJournalStore();
    const now = () => 1_000_000;
    const aiRuntime = runtime({ seen, calls: [], store, now, toolCallId: "call_0" });
    const journal = createJournal({ store, now });
    const first = await journal.start("assist", {});
    const second = await journal.start("assist", {});
    await park(aiRuntime, first);
    await park(aiRuntime, second);
    const a = parkedId(first);
    const b = parkedId(second);
    expect(a).not.toBe(b);
    expect(parseApprovalId(a)?.toolCallId).toBe("call_0");
    expect(parseApprovalId(b)?.toolCallId).toBe("call_0");
    expect(
      await resolveAgentApproval(store, a, { decision: "approve", tenant: null }, now),
    ).toEqual({ ok: true });
    expect((await readAgentApproval(store, b))?.status).toBe("pending");
    expect(
      await resolveAgentApproval(store, b, { decision: "deny", reason: "no", tenant: null }, now),
    ).toEqual({ ok: true });
  });

  test("two instances on one postgres journal: one wins and entries stay", async () => {
    const store = await createPostgresJournalStore({ sql: createPostgresJournalFake() });
    const now = () => 1_000_000;
    const journal = createJournal({ store, now });
    const session = await journal.start("assist", { message: "refund" });
    await session.step("keep-me", () => ({ n: 1 }));
    const aiRuntime = runtime({ seen: [], calls: [], store, now });
    await park(aiRuntime, session);
    const id = parkedId(session);
    const [left, right] = await Promise.all([
      resolveAgentApproval(store, id, { decision: "approve", tenant: null }, now),
      resolveAgentApproval(store, id, { decision: "deny", reason: "late", tenant: null }, now),
    ]);
    const wins = [left, right].filter((result) => result.ok);
    const lost = [left, right].filter((result) => !result.ok);
    expect(wins).toHaveLength(1);
    expect(lost).toEqual([{ ok: false, status: 409, reason: "lease", retryAfterSeconds: 30 }]);
    const row = await store.get(session.runId);
    expect(row?.entries.some((entry) => entry.kind === "step" && entry.name === "keep-me")).toBe(
      true,
    );
    const approval = row?.entries.find(
      (entry) => entry.kind === "step" && entry.name === `ai-approval:${id}`,
    );
    expect(approval?.kind === "step" && (approval.value as { status: string }).status).not.toBe(
      "pending",
    );
    await store.close();
  });
});
