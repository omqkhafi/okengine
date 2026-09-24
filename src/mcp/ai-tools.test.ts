/**
 * Read-only AI and decision MCP tools.
 *
 * Same authorization shape as `oke.traces.*`: one of the declared scopes,
 * no confirmation, and no resolve or promote tool.
 */

import { describe, expect, test } from "bun:test";
import { createSessionStore } from "../auth/sessions.ts";
import { authorizeToolCall } from "./authorization.ts";
import { mintMcpSession, authenticateMcpRequest } from "./session.ts";
import { createToolRuntime } from "./tools.ts";

const SECRET = "mcp-ai-secret";

const runA = {
  id: "run-a",
  agent: "support",
  tenant: "acme",
  status: "interrupted",
};
const runB = {
  id: "run-b",
  agent: "support",
  tenant: "other",
  status: "finished",
};

describe("MCP AI and decision tools", () => {
  test("traces scope cannot read agent runs, and there is no resolve tool", () => {
    expect(
      authorizeToolCall("oke.ai.runs.list", {}, ["mcp:traces:read"], { confirmed: true }).ok,
    ).toBe(false);
    const resolve = authorizeToolCall("oke.ai.approvals.resolve", {}, ["console:*"]);
    expect(resolve.ok).toBe(false);
    if (resolve.ok) return;
    expect(resolve.reason).toBe("unknown-tool");
    const promote = authorizeToolCall("oke.decisions.promote", {}, ["mcp:*"]);
    expect(promote.ok).toBe(false);
    if (promote.ok) return;
    expect(promote.reason).toBe("unknown-tool");
    expect(
      authorizeToolCall("oke.ai.runs.list", {}, ["console:runs:read"], { confirmed: true }).ok,
    ).toBe(true);
  });

  test("list and get stay inside the requested tenant and return events", async () => {
    const runtime = createToolRuntime({
      getManifest: () => ({ oke: "1.0", app: "skyport" }),
      listRuns: async () => [],
      listAgentRuns: async () => [runA, runB],
      getAgentRun: async (runId) => {
        const run = [runA, runB].find((row) => row.id === runId);
        if (!run) return undefined;
        return { run, events: [{ seq: 1, event: { type: "RUN_FINISHED" } }] };
      },
      listApprovals: async () => [
        { id: "a", tenant: "acme", tool: "refund" },
        { id: "b", tenant: "other", tool: "refund" },
      ],
      listDecisions: async () => [{ name: "triage", state: "learning", pending: 1, drift: false }],
    });
    const store = createSessionStore();
    const issued = await mintMcpSession({
      store,
      secret: SECRET,
      principalId: "op",
      scopes: ["mcp:ai:read", "mcp:decisions:read"],
    });
    const requester = await authenticateMcpRequest(store, SECRET, issued.accessToken);

    const listed = await runtime.callTool(requester, "oke.ai.runs.list", { tenant: "acme" });
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const runs = (listed.data.content as { runs: { id: string }[] }).runs;
    expect(runs.map((row) => row.id)).toEqual(["run-a"]);

    const foreign = await runtime.callTool(requester, "oke.ai.runs.get", {
      runId: "run-b",
      tenant: "acme",
    });
    expect(foreign.ok).toBe(false);

    const got = await runtime.callTool(requester, "oke.ai.runs.get", {
      runId: "run-a",
      tenant: "acme",
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect((got.data.content as { events: { seq: number }[] }).events[0]?.seq).toBe(1);

    const approvals = await runtime.callTool(requester, "oke.ai.approvals.list", {
      tenant: "acme",
    });
    expect(approvals.ok).toBe(true);
    if (!approvals.ok) return;
    expect(
      (approvals.data.content as { rows: { id: string }[] }).rows.map((row) => row.id),
    ).toEqual(["a"]);

    const decisions = await runtime.callTool(requester, "oke.decisions.list", {});
    expect(decisions.ok).toBe(true);
    if (!decisions.ok) return;
    expect(
      (decisions.data.content as { decisions: { pending: number; drift: boolean }[] }).decisions[0],
    ).toMatchObject({ pending: 1, drift: false });
  });
});
