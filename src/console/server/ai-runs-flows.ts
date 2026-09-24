/**
 * Operator routes for agent runs and the tool-approval queue.
 *
 * Resolve uses the journal lease. `Conflict` is a finished approval.
 * `JournalLeaseBusy` carries `Retry-After` while another worker holds the run.
 */

import { z } from "zod";
import { journalLeaseBusyResponse, resolveAgentApproval } from "../../elements/ai/approval.ts";
import { fail, flow, http, type Binding } from "../../kernel/index.ts";
import { bindHttp } from "./bind.ts";
import { loadApprovalQueue, loadConsoleAgentRun, loadConsoleAgentRuns } from "./ai-runs.ts";
import type { ConsoleState } from "./state.ts";

const AuthFailed = z.object({});

const StopReason = z.enum(["completed", "max_steps", "budget", "denied", "aborted", "error"]);

const TrailStep = z.object({
  tool: z.string(),
  status: z.enum(["ok", "denied"]),
  effects: z.array(
    z.object({
      kind: z.enum([
        "read",
        "write",
        "emit",
        "send",
        "ask",
        "embed",
        "secret",
        "call",
        "fetch",
        "decide",
      ]),
      resource: z.string(),
    }),
  ),
  denial: z
    .object({
      agent: z.string(),
      tool: z.string(),
      gate: z.string(),
      reason: z.string(),
      at: z.number(),
    })
    .nullable(),
  approver: z.string().optional(),
  at: z.number(),
});

const RunRow = z.object({
  id: z.string(),
  agent: z.string(),
  status: z.enum(["running", "finished", "error", "interrupted"]),
  stopReason: StopReason.optional(),
  error: z.string().optional(),
  steps: z.number(),
  cost: z.number(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  threadId: z.string().optional(),
  startedAt: z.number(),
  finishedAt: z.number().optional(),
  parentRunId: z.string().optional(),
  tenant: z.string().nullable(),
});

const RunDetail = RunRow.extend({
  message: z.string(),
  trail: z.array(TrailStep),
  denials: z.array(
    z.object({
      agent: z.string(),
      tool: z.string(),
      gate: z.string(),
      reason: z.string(),
      at: z.number(),
    }),
  ),
  repairs: z.array(
    z.object({
      prompt: z.string(),
      at: z.number(),
      attempts: z.number(),
    }),
  ),
  children: z.array(RunRow),
  events: z.array(
    z.object({
      seq: z.number(),
      event: z.record(z.string(), z.unknown()),
    }),
  ),
});

const RunsOut = z.object({ runs: z.array(RunDetail) });
const RunOut = z.object({ run: RunDetail });

const ApprovalsOut = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      agent: z.string(),
      tool: z.string(),
      args: z.unknown(),
      requestedAt: z.number(),
      ageMs: z.number(),
      gate: z.string(),
      tenant: z.string().nullable(),
      runId: z.string(),
    }),
  ),
});

const ApproveIn = z.object({
  id: z.string().min(1),
  args: z.unknown().optional(),
});

const DenyIn = z.object({
  id: z.string().min(1),
  reason: z.string().optional(),
});

const ResolveOut = z.object({ ok: z.literal(true) });

/**
 * Parse edited tool args. A string must be JSON. Other JSON values pass through.
 *
 * @param args - Body field
 */
export function parseEditedArgs(
  args: unknown,
): { readonly ok: true; readonly value?: unknown } | { readonly ok: false } {
  if (args === undefined) return { ok: true };
  if (typeof args === "string") {
    try {
      return { ok: true, value: JSON.parse(args) as unknown };
    } catch {
      return { ok: false };
    }
  }
  return { ok: true, value: args };
}

/**
 * List, detail, and resolve bindings.
 *
 * @param state - Console state
 */
export function agentConsoleBindings(state: ConsoleState): Binding[] {
  const sources = () => ({
    runtime: state.aiRuntime,
    store: state.journalStore,
    now: Date.now(),
  });

  const list = flow("console.ai.runs.list", {
    plane: "operator",
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return { runs: await loadConsoleAgentRuns(sources()) };
    },
  });
  const get = flow("console.ai.runs.get", {
    plane: "operator",
    do: async (input: { runId?: string }, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const runId = typeof input.runId === "string" ? input.runId : "";
      const run = await loadConsoleAgentRun(sources(), runId);
      if (!run) return fx.fail.notFound();
      return { run };
    },
  });
  const queue = flow("console.ai.approvals.list", {
    plane: "operator",
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return { rows: await loadApprovalQueue(state.journalStore, Date.now()) };
    },
  });
  const approve = flow("console.ai.approvals.approve", {
    plane: "operator",
    do: async (input: { id: string; args?: unknown }, fx) => {
      const reviewer = fx.operator.id;
      if (!reviewer) return fail("AuthFailed", {});
      const edited = parseEditedArgs(input.args);
      if (!edited.ok) {
        return fail("ValidationError", {
          issues: [{ message: "edited args must be JSON", path: ["args"] }],
        });
      }
      return resolveApproval(state, input.id, reviewer, {
        decision: "approve",
        ...(edited.value !== undefined ? { args: edited.value } : {}),
      });
    },
  });
  const deny = flow("console.ai.approvals.deny", {
    plane: "operator",
    do: async (input: { id: string; reason?: string }, fx) => {
      const reviewer = fx.operator.id;
      if (!reviewer) return fail("AuthFailed", {});
      return resolveApproval(state, input.id, reviewer, {
        decision: "deny",
        ...(input.reason !== undefined ? { reason: input.reason } : {}),
      });
    },
  });

  return [
    bindHttp(http.get("/console/ai/runs", { out: RunsOut, errors: { AuthFailed } }), list),
    bindHttp(http.get("/console/ai/runs/:runId", { out: RunOut, errors: { AuthFailed } }), get),
    bindHttp(
      http.get("/console/ai/approvals", { out: ApprovalsOut, errors: { AuthFailed } }),
      queue,
    ),
    bindHttp(
      http.post("/console/ai/approvals/approve", {
        in: ApproveIn,
        out: ResolveOut,
        errors: { AuthFailed },
      }),
      approve,
    ),
    bindHttp(
      http.post("/console/ai/approvals/deny", {
        in: DenyIn,
        out: ResolveOut,
        errors: { AuthFailed },
      }),
      deny,
    ),
  ];
}

async function resolveApproval(
  state: ConsoleState,
  id: string,
  reviewer: string,
  decision: {
    readonly decision: "approve" | "deny";
    readonly args?: unknown;
    readonly reason?: string;
  },
): Promise<unknown> {
  const store = state.journalStore;
  if (!store) return fail.notFound();
  const { readAgentApproval } = await import("../../elements/ai/approval.ts");
  const pending = await readAgentApproval(store, id);
  const result = await resolveAgentApproval(store, id, {
    decision: decision.decision,
    tenant: pending?.tenant ?? null,
    approver: reviewer,
    ...(decision.args !== undefined ? { args: decision.args } : {}),
    ...(decision.reason !== undefined ? { reason: decision.reason } : {}),
  });
  if (result.ok) {
    await state.afterAgentApproval?.();
    return { ok: true as const };
  }
  if (result.status === 409 && result.reason === "lease") {
    return journalLeaseBusyResponse(result.retryAfterSeconds);
  }
  if (result.status === 409) return fail.conflict();
  if (result.status === 403) return fail.forbidden();
  return fail.notFound();
}
