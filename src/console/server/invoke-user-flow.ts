/**
 * Host-app adapter for Console invoke-as (`POST /console/flows/invoke`).
 *
 * Mirrors {@link ConsoleState.replayTrace}: Console never executes user flows
 * in-process itself — a bound host `OkeApp` runs them under a trusted
 * invoke-as principal (`extras.trustedInvoke`).
 */

import { userPrincipal, type UserPrincipal } from "../../auth/planes.ts";
import { assembleInput } from "../../compiler/http-parse.ts";
import type { ExecuteResult, OkeApp } from "../../kernel/app.ts";
import { OkeError } from "../../kernel/errors.ts";
import type { AnyFlowDef } from "../../kernel/flow.ts";
import { isJsonResult } from "../../kernel/fx.ts";
import { isFlowFailure } from "../../kernel/hooks.ts";
import type { Trigger } from "../../kernel/triggers.ts";
import type { RlsIdentity } from "../../drivers/pg-rls.ts";
import { resolveRlsIdentity } from "../../elements/store.ts";
import type { Manifest } from "../../manifest/types.ts";
import type { ConsoleIdentity } from "./state.ts";

/** Input to {@link ConsoleInvokeUserFlow}. */
export interface InvokeUserFlowInput {
  readonly flowId: string;
  readonly body: unknown;
  readonly pathParams?: Readonly<Record<string, string>>;
  readonly principal: UserPrincipal;
  readonly operatorId: string;
  readonly reason?: string;
  /** Operator card — skip the flow's gate chain (trusted invoke only). */
  readonly bypassGates?: boolean;
  /**
   * Open host store handles with cleartext PII (audited by Call API).
   * Envelope remask is skipped separately when this is true.
   */
  readonly revealPii?: boolean;
  /** Same bag as SQL console / browse — stamped onto host `fx.store`. */
  readonly rls?: RlsIdentity;
}

/** Resolved Call API invoke-as principal. */
export type ResolvedInvokeAs =
  | {
      readonly ok: true;
      readonly principal: UserPrincipal;
      readonly asUserId: string;
      readonly asGate: string | null;
      readonly bypassGates: boolean;
      readonly rls: RlsIdentity | null;
    }
  | { readonly ok: false; readonly reason: string };

/**
 * Map Operator / Public / As onto a host principal.
 *
 * @param input - Optional identity + Gate name
 * @param identities - Seeded Console identities
 * @param manifest - Current Manifest (policy scopes)
 */
export function resolveInvokeAs(
  input: { readonly asUserId?: string; readonly asGate?: string },
  identities: readonly ConsoleIdentity[],
  manifest: Manifest | null,
): ResolvedInvokeAs {
  const asUserId = input.asUserId?.trim() || undefined;
  const asGate = input.asGate?.trim() || undefined;

  if (asUserId) {
    const identity = identities.find((row) => row.id === asUserId);
    if (!identity || identity.status !== "active") {
      return { ok: false, reason: "identity not found or disabled" };
    }
    return {
      ok: true,
      principal: userPrincipal({
        userId: identity.id,
        scopes: identity.scopes,
        verified: true,
      }),
      asUserId: identity.id,
      asGate: asGate ?? null,
      bypassGates: false,
      rls: resolveRlsIdentity({
        asUserId: identity.id,
        asGate: asGate ?? null,
        identities,
        manifest,
      }),
    };
  }

  if (!asGate) {
    return {
      ok: true,
      principal: userPrincipal({
        userId: "console:operator",
        scopes: [],
        verified: true,
      }),
      asUserId: "console:operator",
      asGate: null,
      bypassGates: true,
      rls: null,
    };
  }

  if (asGate === "public") {
    return {
      ok: true,
      principal: userPrincipal({
        userId: "",
        scopes: [],
        verified: false,
      }),
      asUserId: "public",
      asGate: "public",
      bypassGates: false,
      rls: resolveRlsIdentity({ asGate: "public", manifest }),
    };
  }

  const gate = manifest?.gates?.[asGate];
  if (!gate || gate.kind === "rate" || asGate.startsWith("rate:")) {
    return { ok: false, reason: `unknown gate: ${asGate}` };
  }
  const scopes = gate.scopes && gate.scopes.length > 0 ? gate.scopes : [asGate];
  return {
    ok: true,
    principal: userPrincipal({
      userId: "",
      scopes,
      verified: true,
    }),
    asUserId: "",
    asGate,
    bypassGates: false,
    rls: resolveRlsIdentity({ asGate, manifest }),
  };
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
  /** Host telemetry cache dimension — omit when the host did not report one. */
  readonly cache?: "hit" | "miss" | "none";
  /** Handler duration from the host execute (high-res ms). */
  readonly durationMs?: number;
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
    case "InternalError":
      return 500;
    default:
      return code.startsWith("OKE") ? 500 : 400;
  }
}

/**
 * Project an {@link ExecuteResult} into the Console invoke envelope.
 *
 * @param result - Host execute result
 * @param runId - Run id passed to execute (when known)
 */
export async function invokeResultFromExecute(
  result: ExecuteResult,
  runId?: string,
): Promise<InvokeUserFlowResult> {
  if (result.failure) {
    return withInvokeCache(invokeFailureFromError(result.failure.error, runId), result);
  }

  const thrown = result.ctx.error;
  if (thrown !== undefined) {
    if (isFlowFailure(thrown)) {
      return withInvokeCache(invokeFailureFromError(thrown.error, runId), result);
    }
    return withInvokeCache(invokeFailureFromThrown(thrown, runId), result);
  }

  let output = unwrapExecuteOutput(result.output);
  if (output === undefined && result.response) {
    const fromHttp = await outputFromHttpResponse(result.response);
    if (fromHttp.kind === "failure") {
      return withInvokeCache(
        {
          output: null,
          failure: fromHttp.failure,
          status: fromHttp.status,
          ...(runId !== undefined ? { runId } : {}),
        },
        result,
      );
    }
    output = fromHttp.output;
  }
  return withInvokeCache(
    {
      output: output ?? null,
      status: 200,
      ...(runId !== undefined ? { runId } : {}),
    },
    result,
  );
}

function withInvokeCache(base: InvokeUserFlowResult, result: ExecuteResult): InvokeUserFlowResult {
  return {
    ...base,
    ...(result.cache === undefined ? {} : { cache: result.cache }),
    ...(Number.isFinite(result.durationMs) ? { durationMs: result.durationMs } : {}),
  };
}

function invokeFailureFromError(
  err: { readonly code: string; readonly data?: unknown; readonly message?: string },
  runId?: string,
): InvokeUserFlowResult {
  return {
    output: null,
    failure: {
      code: err.code,
      data: err.data,
      ...(err.message !== undefined ? { message: err.message } : {}),
    },
    status: statusForInvokeFailure(err.code),
    ...(runId !== undefined ? { runId } : {}),
  };
}

function invokeFailureFromThrown(thrown: unknown, runId?: string): InvokeUserFlowResult {
  if (thrown instanceof OkeError) {
    return {
      output: null,
      failure: {
        code: `OKE${thrown.code}`,
        message: thrown.causeText,
        data: { fix: thrown.fix, ...thrown.params },
      },
      status: 500,
      ...(runId !== undefined ? { runId } : {}),
    };
  }
  return {
    output: null,
    failure: {
      code: "InternalError",
      message: thrown instanceof Error ? thrown.message : String(thrown),
    },
    status: 500,
    ...(runId !== undefined ? { runId } : {}),
  };
}

function unwrapExecuteOutput(output: unknown): unknown {
  if (isJsonResult(output)) return output.value;
  return output;
}

type HttpInvokeBody =
  | { readonly kind: "ok"; readonly output: unknown }
  | { readonly kind: "failure"; readonly failure: InvokeUserFlowFailure; readonly status: number };

async function outputFromHttpResponse(response: Response): Promise<HttpInvokeBody> {
  try {
    const body: unknown = await response.clone().json();
    if (body && typeof body === "object") {
      const rec = body as {
        data?: unknown;
        error?: { code?: unknown; data?: unknown; message?: unknown } | null;
      };
      if (
        rec.error != null &&
        typeof rec.error === "object" &&
        typeof rec.error.code === "string"
      ) {
        const code = rec.error.code;
        return {
          kind: "failure",
          failure: {
            code,
            ...(rec.error.data !== undefined ? { data: rec.error.data } : {}),
            ...(typeof rec.error.message === "string" ? { message: rec.error.message } : {}),
          },
          status: response.status >= 400 ? response.status : statusForInvokeFailure(code),
        };
      }
      if ("data" in rec) {
        return { kind: "ok", output: rec.data };
      }
    }
    return { kind: "ok", output: body };
  } catch {
    if (response.status >= 400) {
      return {
        kind: "failure",
        failure: { code: "InternalError", message: `HTTP ${response.status}` },
        status: response.status,
      };
    }
    return { kind: "ok", output: undefined };
  }
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
      ...(input.bypassGates === true ? { bypassGates: true } : {}),
      ...(input.revealPii === true ? { revealPii: true } : {}),
      ...(input.rls ? { rls: input.rls } : {}),
      principal: {
        plane: "user",
        userId: input.principal.userId.length > 0 ? input.principal.userId : null,
        scopes: input.principal.scopes,
        verified: input.principal.verified,
      },
      ...(input.pathParams !== undefined ? { params: { ...input.pathParams } } : {}),
    });

    return await invokeResultFromExecute(result, runId);
  };
}
