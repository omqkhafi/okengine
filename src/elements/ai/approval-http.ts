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

/**
 * Map a resolution to the HTTP failure the rest of the kernel already speaks.
 *
 * @param fx - Flow context
 * @param result - Approval resolution
 */
function approvalHttpResult(
  fx: Fx,
  result: { readonly ok: true } | { readonly ok: false; readonly status: 403 | 404 | 409 },
): unknown {
  if (result.ok) return { ok: true };
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
    trigger: http.post("/agent/approvals/approve").public(),
    flow: flow("oke.agent.approve", {
      effects: { writes: ["journal:runs"] },
      do: async (input, fx) => {
        const body = (input ?? {}) as { id?: string; args?: unknown };
        if (!body.id) return fx.fail.notFound();
        const result = await fx.agent.approve(body.id, { args: body.args });
        return approvalHttpResult(fx, result);
      },
    }),
  });
  adopt({
    trigger: http.post("/agent/approvals/deny").public(),
    flow: flow("oke.agent.deny", {
      effects: { writes: ["journal:runs"] },
      do: async (input, fx) => {
        const body = (input ?? {}) as { id?: string; reason?: string };
        if (!body.id) return fx.fail.notFound();
        const result = await fx.agent.deny(body.id, { reason: body.reason });
        return approvalHttpResult(fx, result);
      },
    }),
  });
}
