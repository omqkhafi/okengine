/**
 * Console agent-run routes and the approval lease.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { issueSession } from "../../auth/index.ts";
import { approvalId } from "../../elements/ai/approval.ts";
import { createMemoryJournalStore } from "../../kernel/journal.ts";
import { startConsoleApp } from "./serve.ts";
import { parseEditedArgs } from "./ai-runs-flows.ts";
import { loadConsoleAgentRuns, projectApprovalQueue } from "./ai-runs.ts";

const cwd = await mkdtemp(join(tmpdir(), "oke-console-ai-"));

describe("parseEditedArgs", () => {
  test("a string must be JSON and an empty omission stays omitted", () => {
    expect(parseEditedArgs(undefined)).toEqual({ ok: true });
    expect(parseEditedArgs('{"amount":4}')).toEqual({ ok: true, value: { amount: 4 } });
    expect(parseEditedArgs("{")).toEqual({ ok: false });
    expect(parseEditedArgs({ amount: 4 })).toEqual({ ok: true, value: { amount: 4 } });
  });
});

describe("console agent routes", () => {
  const store = createMemoryJournalStore();
  const id = approvalId("run-parked", "tc1");
  const handlePromise = startConsoleApp({
    cwd,
    secret: "test-secret-console-ai",
    silentClaim: true,
    journalStore: store,
  });
  let token = "";
  let claiming: Promise<void> | undefined;

  afterAll(async () => {
    const handle = await handlePromise;
    await handle.app.stop();
  });

  async function operator(): Promise<Awaited<typeof handlePromise>> {
    const handle = await handlePromise;
    if (!claiming) {
      claiming = (async () => {
        const claim = await handle.app.fetch(
          new Request("http://console.test/console/setup/claim", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              claimCode: handle.state.claim.code,
              email: "ops@example.com",
              name: "Ops",
              password: "Password1234!",
            }),
          }),
        );
        const body = (await claim.json()) as { data?: { accessToken: string } };
        token = body.data?.accessToken ?? "";
      })();
    }
    await claiming;
    return handle;
  }

  test("an application principal cannot list approvals", async () => {
    const app = await operator();
    const user = await issueSession(
      app.state.sessions,
      { secret: app.state.secret, now: app.state.now },
      { id: "user-1", plane: "user", scopes: ["bookings:create"] },
    );
    const res = await app.app.fetch(
      new Request("http://console.test/console/ai/approvals", {
        headers: { authorization: `Bearer ${user.accessToken}` },
      }),
    );
    expect(res.status).toBe(403);
  });

  test("the queue shows the tenant, the first approve wins, and the second is Conflict", async () => {
    await store.put({
      id: "run-parked",
      flow: "assist",
      input: {},
      status: "sleeping",
      entries: [
        {
          kind: "step",
          name: `ai-approval:${id}`,
          at: 1_000,
          value: {
            status: "pending",
            agent: "support",
            tool: "refund",
            args: { amount: 10 },
            gate: "ops",
            tenant: "ws_keel",
            requestedAt: 1_000,
          },
        },
      ],
      createdAt: 1_000,
      updatedAt: 1_000,
      wakeAt: Date.now() + 60_000,
    });
    const app = await operator();
    const listed = await app.app.fetch(
      new Request("http://console.test/console/ai/approvals", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(listed.status).toBe(200);
    const queue = (await listed.json()) as {
      data: { rows: { agent: string; tenant: string; tool: string }[] };
    };
    expect(queue.data.rows[0]).toMatchObject({
      agent: "support",
      tool: "refund",
      tenant: "ws_keel",
    });

    const first = await app.app.fetch(
      new Request("http://console.test/console/ai/approvals/approve", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id, args: { amount: 4 } }),
      }),
    );
    expect(first.status).toBe(200);

    const second = await app.app.fetch(
      new Request("http://console.test/console/ai/approvals/approve", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id }),
      }),
    );
    expect(second.status).toBe(409);
    const conflict = (await second.json()) as { error: { code: string } };
    expect(conflict.error.code).toBe("Conflict");
    expect(second.headers.get("retry-after")).toBeNull();
  });

  test("a held lease is JournalLeaseBusy with Retry-After", async () => {
    const busyId = approvalId("run-busy", "tc2");
    await store.put({
      id: "run-busy",
      flow: "assist",
      input: {},
      status: "sleeping",
      entries: [
        {
          kind: "step",
          name: `ai-approval:${busyId}`,
          at: 1_000,
          value: {
            status: "pending",
            agent: "support",
            tool: "refund",
            args: { amount: 1 },
            gate: "ops",
            tenant: null,
            requestedAt: 1_000,
          },
        },
      ],
      createdAt: 1_000,
      updatedAt: 1_000,
      wakeAt: Date.now() + 60_000,
    });
    await store.acquireLease?.("run-busy", "other", Date.now(), 30_000);
    const app = await operator();
    const res = await app.app.fetch(
      new Request("http://console.test/console/ai/approvals/deny", {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ id: busyId, reason: "no" }),
      }),
    );
    expect(res.status).toBe(409);
    expect(res.headers.get("retry-after")).not.toBeNull();
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("JournalLeaseBusy");
  });
});

describe("projectApprovalQueue", () => {
  test("age is now minus requestedAt and a foreign tenant is dropped", () => {
    const id = approvalId("run", "tc");
    const rows = projectApprovalQueue(
      [
        {
          id: "run",
          flow: "assist",
          input: {},
          status: "sleeping",
          entries: [
            {
              kind: "step",
              name: `ai-approval:${id}`,
              at: 1_000,
              value: {
                status: "pending",
                agent: "support",
                tool: "refund",
                args: {},
                gate: "ops",
                tenant: "a",
                requestedAt: 1_000,
              },
            },
          ],
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
      61_000,
      "b",
    );
    expect(rows).toEqual([]);
    const kept = projectApprovalQueue(
      [
        {
          id: "run",
          flow: "assist",
          input: {},
          status: "sleeping",
          entries: [
            {
              kind: "step",
              name: `ai-approval:${id}`,
              at: 1_000,
              value: {
                status: "pending",
                agent: "support",
                tool: "refund",
                args: {},
                gate: "ops",
                tenant: "a",
                requestedAt: 1_000,
              },
            },
          ],
          createdAt: 1_000,
          updatedAt: 1_000,
        },
      ],
      61_000,
      "a",
    );
    expect(kept[0]?.ageMs).toBe(60_000);
    expect(kept[0]?.tenant).toBe("a");
  });
});

describe("loadConsoleAgentRuns", () => {
  test("the follow-log header names the agent and the journal step is the trail", async () => {
    const store = createMemoryJournalStore();
    const agentEvents = store.agentEvents;
    if (!agentEvents) throw new Error("agent event store missing");
    const id = approvalId("journal-run", "tc1");
    await agentEvents.writeHeader({
      runId: "run-logged",
      threadId: "thread-1",
      agent: "support",
      tenant: null,
      gates: [],
      userId: null,
      operatorId: null,
      openedAt: 1_000,
    });
    await agentEvents.append("run-logged", {
      seq: 1,
      event: {
        type: "RUN_FINISHED",
        threadId: "thread-1",
        runId: "run-logged",
        outcome: { type: "interrupt", interrupts: [{ id, reason: "approval" }] },
      },
    });
    await agentEvents.append("run-logged", {
      seq: 2,
      event: { type: "TOOL_CALL_START", toolCallId: "tc1", toolCallName: "refund" },
    });
    await agentEvents.append("run-logged", {
      seq: 3,
      event: { type: "STEP_STARTED", stepName: "step-1" },
    });
    await store.put({
      id: "journal-run",
      flow: "assist",
      input: {},
      status: "sleeping",
      entries: [
        {
          kind: "step",
          name: `ai-approval:${id}`,
          at: 1_000,
          value: {
            status: "pending",
            agent: "support",
            tool: "refund",
            args: { amount: 10 },
            gate: "ops",
            tenant: null,
            requestedAt: 1_000,
          },
        },
      ],
      createdAt: 1_000,
      updatedAt: 1_000,
    });
    const runs = await loadConsoleAgentRuns({ runtime: null, store, now: 2_000 });
    expect(runs[0]?.agent).toBe("support");
    expect(runs[0]?.threadId).toBe("thread-1");
    expect(runs[0]?.status).toBe("interrupted");
    expect(runs[0]?.steps).toBe(1);
    expect(runs[0]?.trail[0]).toMatchObject({ tool: "refund", status: "pending" });
  });
});
