/**
 * Built-in HTTP approve / deny for a parked agent tool.
 *
 * The route is public so the request can arrive. The tool's own gate is
 * checked inside `fx.agent`. `Idempotency-Key` applies because the flow writes.
 */

import { flow } from "../../kernel/flow.ts";
import type { Fx } from "../../kernel/fx.ts";
import type { Binding } from "../../kernel/on.ts";
import { http } from "../../kernel/triggers.ts";
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
}
