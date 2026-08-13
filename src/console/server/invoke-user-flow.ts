/**
 * Host-app adapter for Console invoke-as (`POST /console/flows/invoke`).
 *
 * Mirrors {@link ConsoleState.replayTrace}: Console never executes user flows
 * in-process itself — a bound host `OkeApp` runs them under a trusted
 * invoke-as principal (`extras.trustedInvoke`).
 */

import type { UserPrincipal } from "../../auth/planes.ts";
import { assembleInput } from "../../compiler/http-parse.ts";
import type { ExecuteResult, OkeApp } from "../../kernel/app.ts";
import type { AnyFlowDef } from "../../kernel/flow.ts";
import type { Trigger } from "../../kernel/triggers.ts";

/** Input to {@link ConsoleInvokeUserFlow}. */
export interface InvokeUserFlowInput {
  readonly flowId: string;
  readonly body: unknown;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly principal: UserPrincipal;
  readonly operatorId: string;
  readonly reason?: string;
}

/** Host typed failure surfaced to the Console Call API. */
export interface InvokeUserFlowFailure {
  readonly code: string;
  readonly data?: unknown;
  readonly message?: string;
}

/** Result of a real host invoke-as execution. */
export interface InvokeUserFlowResult {
  readonly output: unknown;
  readonly failure?: InvokeUserFlowFailure;
  readonly status?: number;
  readonly runId?: string;
}

/**
 * Optional ConsoleState hook — when unset, `console.flows.invoke` fails closed.
 */
export type ConsoleInvokeUserFlow = (input: InvokeUserFlowInput) => Promise<InvokeUserFlowResult>;

/** Minimal host surface needed to bind invoke-as. */
export type InvokeHostApp = Pick<OkeApp, "bindings" | "execute">;

/**
 * Map a host typed failure code to an HTTP-ish status for Call API chrome.
 *
 * @param code - Failure code from the host pipeline
 */
export function statusForInvokeFailure(code: string): number {
  switch (code) {
    case "Unauthorized":
      return 401;
    case "Forbidden":
      return 403;
    case "RateLimited":
      return 429;
    case "NotFound":
      return 404;
    default:
      return 400;
  }
}

/**
 * Project an {@link ExecuteResult} into the Console invoke envelope.
 *
 * @param result - Host execute result
 * @param runId - Run id passed to execute (when known)
 */
export function invokeResultFromExecute(
  result: ExecuteResult,
  runId?: string,
): InvokeUserFlowResult {
  if (result.failure) {
    const err = result.failure.error;
    const code = err.code;
    return {
      output: null,
      failure: {
        code,
        data: err.data,
        ...(err.message !== undefined ? { message: err.message } : {}),
      },
      status: statusForInvokeFailure(code),
      ...(runId !== undefined ? { runId } : {}),
    };
  }
  return {
    output: result.output,
    status: 200,
    ...(runId !== undefined ? { runId } : {}),
  };
}

/**
 * Bind a booted host {@link OkeApp} as {@link ConsoleInvokeUserFlow}.
 *
 * Uses `trustedInvoke: true` so the assumed identity is applied outside
 * `env: "test"` without opening public HTTP principal injection.
 *
 * @param app - Booted host application
 */
export function bindHostInvokeUserFlow(app: InvokeHostApp): ConsoleInvokeUserFlow {
  return async (input) => {
    const binding = app.bindings.find((b) => b.flow.name === input.flowId);
    const flowDef: AnyFlowDef | undefined = binding?.flow;
    if (!flowDef) {
      return {
        output: null,
        failure: { code: "NotFound", data: { flowId: input.flowId } },
        status: 404,
      };
    }

    const trigger: Trigger =
      binding?.trigger ?? flowDef.triggers[0] ?? ({ kind: "internal" } as Trigger);

    const assembled = assembleInput({
      ...(input.pathParams !== undefined ? { params: { ...input.pathParams } } : {}),
      ...(input.body !== undefined ? { body: input.body } : {}),
    });

    const runId = crypto.randomUUID();
    const result = await app.execute(flowDef, assembled, trigger, {
      trustedInvoke: true,
      runId,
      principal: {
        plane: "user",
        userId: input.principal.userId,
        scopes: input.principal.scopes,
        verified: input.principal.verified,
      },
      ...(input.pathParams !== undefined ? { params: { ...input.pathParams } } : {}),
    });

    return invokeResultFromExecute(result, runId);
  };
}
