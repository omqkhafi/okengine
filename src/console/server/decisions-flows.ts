/**
 * Operator routes for the decisions list and the review queue.
 */

import { z } from "zod";
import { journalLeaseBusyResponse } from "../../elements/ai/approval.ts";
import { resolveDecisionReview } from "../../kernel/fx-decide.ts";
import { fail, flow, http, type Binding } from "../../kernel/index.ts";
import { bindHttp } from "./bind.ts";
import type { ConsoleState } from "./state.ts";
import { loadDecisionQueue, projectDecisionList, candidateMetrics } from "./decisions.ts";

const AuthFailed = z.object({});

const DecisionListOut = z.object({
  decisions: z.array(
    z.object({
      name: z.string(),
      state: z.enum(["learning", "candidate", "certified", "suspended"]),
      mode: z.enum(["review", "abstain"]),
      model: z.string().optional(),
      metrics: z.record(z.string(), z.number()).optional(),
      promote: z.string().optional(),
    }),
  ),
  suspended: z.array(z.string()),
  failures: z.array(
    z.object({
      decision: z.string(),
      question: z.string(),
      message: z.string(),
      at: z.number(),
    }),
  ),
});

const DecisionQueueOut = z.object({
  rows: z.array(
    z.object({
      id: z.string(),
      decision: z.string(),
      requestedAt: z.number(),
      ageMs: z.number(),
      labelOnly: z.boolean(),
      status: z.enum(["pending", "reviewed"]),
      questions: z.array(
        z.object({
          id: z.string(),
          kind: z.enum(["boolean", "choice", "score"]),
          options: z.array(z.string()).optional(),
          levels: z.array(z.string()).optional(),
        }),
      ),
    }),
  ),
});

const DecisionResolveIn = z.object({
  id: z.string().min(1),
  values: z.record(z.string(), z.unknown()),
  labelOnly: z.boolean().optional(),
});

const DecisionResolveOut = z.object({ ok: z.literal(true) });

/**
 * List, queue, and resolve bindings.
 *
 * @param state - Console state
 */
export function decisionConsoleBindings(state: ConsoleState): Binding[] {
  const list = flow("console.decisions.list", {
    plane: "operator",
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      const { decisionDriftNames, getDecisionLock } =
        await import("../../elements/ai/decisions/certificate.ts");
      const { decisionLabelWriteFailures, listDecisionCandidates, loadDecisionCandidate } =
        await import("../../elements/ai/decisions/labels.ts");
      const names = await listDecisionCandidates();
      const fitted: Record<string, Record<string, number>> = {};
      for (const name of names) {
        const metrics = candidateMetrics(await loadDecisionCandidate(name));
        if (metrics) fitted[name] = metrics;
      }
      return {
        decisions: projectDecisionList(state.manifest, getDecisionLock(), new Set(names), fitted),
        suspended: decisionDriftNames(),
        failures: decisionLabelWriteFailures(),
      };
    },
  });
  const queue = flow("console.decisions.queue", {
    plane: "operator",
    do: async (_input, fx) => {
      if (!fx.operator.id) return fail("AuthFailed", {});
      return { rows: await loadDecisionQueue(state.journalStore, Date.now()) };
    },
  });
  const resolve = flow("console.decisions.resolve", {
    plane: "operator",
    do: async (input: { id: string; values: Record<string, unknown>; labelOnly?: boolean }, fx) => {
      const reviewer = fx.operator.id;
      if (!reviewer) return fail("Unauthorized", {});
      const store = state.journalStore;
      if (!store) return fx.fail.notFound();
      const result = await resolveDecisionReview(
        store,
        input.id,
        {
          values: input.values,
          reviewer,
          tenantId: fx.tenant.id,
          plane: "operator",
          auth: {
            userId: fx.auth.userId,
            scopes: fx.auth.scopes,
            verified: fx.auth.verified,
          },
        },
        Date.now,
        input.labelOnly === true,
      );
      if (result.ok) return { ok: true as const };
      if (result.status === 409 && result.reason === "lease") {
        return journalLeaseBusyResponse(result.retryAfterSeconds);
      }
      if (result.status === 422) {
        return fail("ValidationError", {
          issues: [{ message: "review values do not match the open questions", path: ["values"] }],
        });
      }
      if (result.status === 503) return fx.fail.serviceUnavailable();
      if (result.status === 403) return fx.fail.forbidden();
      if (result.status === 409) return fx.fail.conflict();
      return fx.fail.notFound();
    },
  });
  return [
    bindHttp(
      http.get("/console/decisions", { out: DecisionListOut, errors: { AuthFailed } }),
      list,
    ),
    bindHttp(
      http.get("/console/decisions/queue", { out: DecisionQueueOut, errors: { AuthFailed } }),
      queue,
    ),
    bindHttp(
      http.post("/console/decisions/resolve", {
        in: DecisionResolveIn,
        out: DecisionResolveOut,
        errors: { AuthFailed },
      }),
      resolve,
    ),
  ];
}
