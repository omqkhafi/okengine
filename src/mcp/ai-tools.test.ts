/**
 * Read-only AI and decision MCP tools.
 *
 * Same authorization shape as `oke.traces.*`: one of the declared scopes,
 * no confirmation, and no resolve or promote tool.
 */

import { describe, expect, test } from "bun:test";
import { createSessionStore } from "../auth/sessions.ts";
import { Redacted } from "../kernel/redacted.ts";
import type { Manifest } from "../manifest/types.ts";
import { authorizeToolCall } from "./authorization.ts";
import { mintMcpSession, authenticateMcpRequest } from "./session.ts";
import { createToolRuntime, type McpContext } from "./tools.ts";

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

  test("a tenant token sees only its tenant; an operator token sees every tenant", async () => {
    const runtime = createToolRuntime({
      getManifest: () => ({ oke: "1.0", app: "skyport" }) as Manifest,
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
      listDecisions: async () => [
        { name: "triage", tenant: "acme", state: "learning", pending: 1, drift: false },
        { name: "other-call", tenant: "other", state: "learning", pending: 0, drift: false },
      ],
    });
    const store = createSessionStore();
    const issued = await mintMcpSession({
      store,
      secret: SECRET,
      principalId: "op",
      scopes: ["mcp:ai:read", "mcp:decisions:read"],
      tenantId: "acme",
    });
    const requester = await authenticateMcpRequest(store, SECRET, issued.accessToken);

    const listed = await runtime.callTool(requester, "oke.ai.runs.list", {});
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    const runs = (listed.data.content as { runs: { id: string }[] }).runs;
    expect(runs.map((row) => row.id)).toEqual(["run-a"]);

    const foreign = await runtime.callTool(requester, "oke.ai.runs.get", { runId: "run-b" });
    expect(foreign.ok).toBe(false);
    const namedOther = await runtime.callTool(requester, "oke.ai.runs.list", { tenant: "other" });
    expect(namedOther.ok).toBe(true);
    if (!namedOther.ok) return;
    expect((namedOther.data.content as { runs: unknown[] }).runs).toEqual([]);
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
      (decisions.data.content as { decisions: { name: string }[] }).decisions.map(
        (row) => row.name,
      ),
    ).toEqual(["triage"]);

    const operatorIssued = await mintMcpSession({
      store,
      secret: SECRET,
      principalId: "root",
      scopes: ["mcp:*"],
    });
    const operator = await authenticateMcpRequest(store, SECRET, operatorIssued.accessToken);
    const allRuns = await runtime.callTool(operator, "oke.ai.runs.list", {});
    expect(allRuns.ok).toBe(true);
    if (!allRuns.ok) return;
    expect((allRuns.data.content as { runs: { id: string }[] }).runs.map((row) => row.id)).toEqual([
      "run-a",
      "run-b",
    ]);
    const otherApprovals = await runtime.callTool(operator, "oke.ai.approvals.list", {
      tenant: "other",
    });
    expect(otherApprovals.ok).toBe(true);
    if (!otherApprovals.ok) return;
    expect(
      (otherApprovals.data.content as { rows: { id: string }[] }).rows.map((row) => row.id),
    ).toEqual(["b"]);
  });

  test("every AI tool masks PII fields and redacted secrets", async () => {
    const secret = Redacted.of("sk-live");
    const manifest = {
      oke: "1.0",
      app: "skyport",
      stores: {
        app: {
          tables: {
            people: { columns: { email: { pii: true }, apiKey: { sensitive: true } } },
          },
        },
      },
    } as unknown as Manifest;
    const ctx: McpContext = {
      getManifest: () => manifest,
      listRuns: async () => [],
      listAgentRuns: async () => [
        {
          id: "run-a",
          tenant: "acme",
          args: { email: "a@b.co", apiKey: secret },
          trail: [{ args: { email: "a@b.co" } }],
        },
      ],
      getAgentRun: async () => ({
        run: { id: "run-a", tenant: "acme", args: { email: "a@b.co", apiKey: secret } },
        events: [{ seq: 1, event: { type: "CUSTOM", value: { email: "a@b.co", apiKey: secret } } }],
      }),
      listApprovals: async () => [
        { id: "a", tenant: "acme", args: { email: "a@b.co", apiKey: secret } },
      ],
      listDecisions: async () => [
        { name: "triage", tenant: "acme", input: { email: "a@b.co", apiKey: secret } },
      ],
    };
    const runtime = createToolRuntime(ctx);
    const store = createSessionStore();
    const issued = await mintMcpSession({
      store,
      secret: SECRET,
      principalId: "op",
      scopes: ["mcp:ai:read", "mcp:decisions:read"],
      tenantId: "acme",
    });
    const requester = await authenticateMcpRequest(store, SECRET, issued.accessToken);
    const blobs = [
      await runtime.callTool(requester, "oke.ai.runs.list", {}),
      await runtime.callTool(requester, "oke.ai.runs.get", { runId: "run-a" }),
      await runtime.callTool(requester, "oke.ai.approvals.list", {}),
      await runtime.callTool(requester, "oke.decisions.list", {}),
    ];
    for (const result of blobs) {
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      const text = JSON.stringify(result.data.content);
      expect(text).not.toContain("a@b.co");
      expect(text).not.toContain("sk-live");
      expect(text).toContain("[redacted]");
    }
  });
});
