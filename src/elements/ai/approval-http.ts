/**
 * Built-in HTTP approve / deny for a parked agent tool.
 *
 * The route is public so the request can arrive. The tool's own gate is
 * checked inside `fx.agent`. `Idempotency-Key` applies because the flow writes.
 */

import { flow } from "../../kernel/flow.ts";
import type { Fx } from "../../kernel/fx.ts";
import { sseComment, sseFrame } from "../../kernel/fx.ts";
import type { Binding } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
import { getAgentEventLog } from "./run-events.ts";
import type { GateRuntime } from "../gate/runtime.ts";
import type { StandardSchemaV1 } from "../../validation/standard-schema.ts";
import { journalLeaseBusyResponse } from "./approval.ts";

/** Body the approve route accepts. `args` replaces the tool input. */
const approveIn: StandardSchemaV1<{ id: string; args?: unknown }> = {
  "~standard": {
    version: 1,
    vendor: "okengine",
    validate(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { issues: [{ message: "expected object", path: [] }] };
      }
      const body = value as { id?: unknown; args?: unknown };
      if (typeof body.id !== "string" || body.id.length === 0) {
        return { issues: [{ message: "id is required", path: ["id"] }] };
      }
      return { value: { id: body.id, ...(body.args !== undefined ? { args: body.args } : {}) } };
    },
  },
};

/** Body the deny route accepts. */
const denyIn: StandardSchemaV1<{ id: string; reason?: string }> = {
  "~standard": {
    version: 1,
    vendor: "okengine",
    validate(value) {
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        return { issues: [{ message: "expected object", path: [] }] };
      }
      const body = value as { id?: unknown; reason?: unknown };
      if (typeof body.id !== "string" || body.id.length === 0) {
        return { issues: [{ message: "id is required", path: ["id"] }] };
      }
      if (body.reason !== undefined && typeof body.reason !== "string") {
        return { issues: [{ message: "reason must be a string", path: ["reason"] }] };
      }
      return {
        value: {
          id: body.id,
          ...(typeof body.reason === "string" ? { reason: body.reason } : {}),
        },
      };
    },
  },
};

/**
 * Map a resolution to the HTTP failure the rest of the kernel already speaks.
 *
 * @param fx - Flow context
 * @param result - Approval resolution
 */
function approvalHttpResult(
  fx: Fx,
  result:
    | { readonly ok: true }
    | { readonly ok: false; readonly status: 403 | 404 }
    | { readonly ok: false; readonly status: 409; readonly reason: "resolved" }
    | {
        readonly ok: false;
        readonly status: 409;
        readonly reason: "lease";
        readonly retryAfterSeconds: number;
      },
): unknown {
  if (result.ok) return { ok: true };
  if (result.status === 409 && result.reason === "lease") {
    return journalLeaseBusyResponse(result.retryAfterSeconds);
  }
  if (result.status === 409) return fx.fail.conflict();
  if (result.status === 403) return fx.fail.forbidden();
  return fx.fail.notFound();
}

/**
 * Register the approve and deny routes on an app.
 *
 * @param adopt - App binding adopter
 */
export function bindAgentApprovalFlows(adopt: (binding: Binding) => void): void {
  adopt({
    trigger: http.post("/agent/approvals/approve", { in: approveIn }).public(),
    flow: flow("oke.agent.approve", {
      effects: { writes: ["journal:runs"] },
      do: async (input, fx) => {
        const body = input as { id: string; args?: unknown };
        const result = await fx.agent.approve(body.id, { args: body.args });
        return approvalHttpResult(fx, result);
      },
    }),
  });
  adopt({
    trigger: http.post("/agent/approvals/deny", { in: denyIn }).public(),
    flow: flow("oke.agent.deny", {
      effects: { writes: ["journal:runs"] },
      do: async (input, fx) => {
        const body = input as { id: string; reason?: string };
        const result = await fx.agent.deny(body.id, { reason: body.reason });
        return approvalHttpResult(fx, result);
      },
    }),
  });
  adopt({
    trigger: http.get("/agent/runs/:runId/events").public(),
    flow: flow("oke.agent.follow", {
      do: async (input, fx) => followAgentRun(input, fx),
    }),
  });
}

let followGates: GateRuntime | undefined;

/**
 * Gate runtime the follow route uses. Boot installs the app's gates.
 *
 * @param gates - Runtime that checked the calling Flow
 */
export function setAgentFollowGates(gates: GateRuntime | undefined): void {
  followGates = gates;
}

async function followAgentRun(input: unknown, fx: Fx): Promise<unknown> {
  const body = (input ?? {}) as { runId?: unknown };
  const runId = typeof body.runId === "string" ? body.runId : "";
  const log = getAgentEventLog();
  if (!log || !runId) return fx.fail.notFound();
  const header = await log.header(runId);
  if (!header) return fx.fail.notFound();
  if ((header.tenant ?? null) !== (fx.tenant.id ?? null)) return fx.fail.notFound();
  const followerIsOperator = fx.operator.id !== null;
  const sameUser = (header.userId ?? null) === (fx.auth.userId ?? null);
  const sameOperator = (header.operatorId ?? null) === (fx.operator.id ?? null);
  const samePrincipal =
    (header.userId === null && header.operatorId === null && sameUser && sameOperator) ||
    (header.userId !== null && sameUser) ||
    (header.operatorId !== null && sameOperator);
  if (!followerIsOperator && !samePrincipal) return fx.fail.forbidden();
  if (header.gates.length > 0) {
    if (!followGates) return fx.fail.forbidden();
    const checks = await followGates.check(header.gates, {
      auth: fx.auth,
      operator: fx.operator,
      meta: {},
    });
    if (checks.some((check) => check.allowed === false)) return fx.fail.forbidden();
  }
  const after = Number(fx.lastEventId ?? "0");
  const afterSeq = Number.isFinite(after) ? after : 0;
  return fx.json.stream(frames(log, runId, afterSeq, fx.signal));
}

async function* frames(
  log: NonNullable<ReturnType<typeof getAgentEventLog>>,
  runId: string,
  afterSeq: number,
  signal: AbortSignal,
): AsyncIterable<unknown> {
  const iter = log.subscribe(runId, afterSeq, signal)[Symbol.asyncIterator]();
  let pending = iter.next();
  try {
    for (;;) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const ping = new Promise<"ping">((resolve) => {
        timer = setTimeout(() => resolve("ping"), 15_000);
      });
      const winner = await Promise.race([
        pending.then((row) => ({ kind: "row" as const, row })),
        ping.then((kind) => ({ kind })),
      ]);
      if (timer) clearTimeout(timer);
      if (winner.kind === "ping") {
        if (signal.aborted) return;
        yield sseComment("keepalive");
        continue;
      }
      pending = iter.next();
      if (winner.row.done || winner.row.value === undefined) return;
      const row = winner.row.value;
      yield sseFrame(row.event, String(row.seq));
      if (row.event.type === "RUN_ERROR") return;
      if (row.event.type === "RUN_FINISHED" && row.event.outcome?.type !== "interrupt") return;
    }
  } finally {
    await iter.return?.();
  }
}
