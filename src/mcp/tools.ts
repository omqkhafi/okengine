/**
 * MCP tool handlers — Manifest, schemas, effects, traces, safe actions.
 *
 * All returns go through {@link asData}. Write tools require a fresh
 * confirmation token (no session-level consent cache).
 */

import type { Manifest } from "../manifest/types.ts";
import type { WideEvent } from "../runs/types.ts";
import {
  authorizeToolCall,
  MCP_TOOL_POLICIES,
  type McpToolPolicy,
} from "./authorization.ts";
import {
  createConfirmationGate,
  MCP_CONFIRM_PHRASE,
  type ConfirmationGateOptions,
} from "./confirmation.ts";
import { asData, freezeData, type McpDataEnvelope } from "./data.ts";
import type { McpRequester } from "./session.ts";

/** Narrow context the MCP surface needs — no token forwarding. */
export interface McpContext {
  /** Current Manifest snapshot. */
  readonly getManifest: () => Manifest | null;
  /** List runs/traces (already operator-scoped by the provider). */
  readonly listRuns: () => Promise<readonly WideEvent[]>;
  /**
   * Safe invoke adapter. Called only after confirmation. Must NOT receive
   * the caller's Bearer token — capabilities are passed as structured input.
   */
  readonly invokeFlow?: (input: {
    readonly flowId: string;
    readonly body: unknown;
    readonly operatorId: string;
    readonly reason: string;
  }) => Promise<unknown>;
  /**
   * Structural propose adapter. Called only after confirmation.
   */
  readonly proposeStructural?: (input: {
    readonly title: string;
    readonly relativePath: string;
    readonly contents: string;
    readonly operatorId: string;
    readonly reason: string;
  }) => Promise<unknown>;
}

/** Result of a tool call — always an inert data envelope or an error envelope. */
export type ToolCallResult =
  | { readonly ok: true; readonly data: McpDataEnvelope }
  | {
      readonly ok: false;
      readonly code: "unauthorized" | "forbidden" | "invalid" | "not-found";
      readonly message: string;
      readonly data: McpDataEnvelope;
    };

/**
 * Create the tool runtime bound to a context + confirmation gate.
 *
 * @param ctx - Manifest / runs / action adapters
 * @param confirmOptions - Confirmation gate options
 */
export function createToolRuntime(
  ctx: McpContext,
  confirmOptions: ConfirmationGateOptions = {},
): {
  readonly listTools: () => readonly McpToolPolicy[];
  readonly callTool: (
    requester: McpRequester,
    name: string,
    args: Record<string, unknown>,
  ) => Promise<ToolCallResult>;
  /** Exposed for tests — confirmation gate has no session consent cache. */
  readonly confirmationSize: () => number;
} {
  const confirm = createConfirmationGate(confirmOptions);

  return {
    listTools: () => MCP_TOOL_POLICIES,
    confirmationSize: () => confirm.size(),
    async callTool(requester, name, args) {
      const policy = MCP_TOOL_POLICIES.find((p) => p.name === name);

      // Scope / param checks first (do not burn a confirmation token on ACL miss).
      const preflight = authorizeToolCall(name, args, requester.scopes, {
        confirmed: policy?.mutability !== "write",
      });
      if (
        !preflight.ok &&
        preflight.reason !== "confirmation-required"
      ) {
        return {
          ok: false,
          code:
            preflight.reason === "unknown-tool" ? "not-found" : "forbidden",
          message: preflight.detail ?? preflight.reason,
          data: asData(
            {
              tool: name,
              reason: preflight.reason,
              detail: preflight.detail ?? null,
            },
            "error",
          ),
        };
      }

      // Write path: consume a fresh per-call confirmation (no session cache).
      if (policy?.mutability === "write") {
        const token =
          typeof args.confirmToken === "string" ? args.confirmToken : "";
        const phrase =
          typeof args.confirmation === "string" ? args.confirmation : "";
        const reason = typeof args.reason === "string" ? args.reason : "";
        const boundArgs = stripConfirmFields(args);
        const consumed = confirm.consume({
          tool: name,
          args: boundArgs,
          principalId: requester.principalId,
          token,
          phrase,
          reason,
        });
        if (!consumed.ok) {
          return {
            ok: false,
            code: "forbidden",
            message: `write tool requires fresh human confirmation (${consumed.reason})`,
            data: asData(
              {
                tool: name,
                requiredPhrase: MCP_CONFIRM_PHRASE,
                confirmVia: "oke.action.confirm",
                reason: consumed.reason,
              },
              "error",
            ),
          };
        }
      }

      switch (name) {
        case "oke.manifest.get":
          return okData(
            freezeData({ manifest: ctx.getManifest() }),
            "manifest",
          );
        case "oke.schema.get":
          return schemaGet(ctx, args);
        case "oke.effects.get":
          return effectsGet(ctx, args);
        case "oke.traces.list":
          return tracesList(ctx, args);
        case "oke.traces.get":
          return tracesGet(ctx, args);
        case "oke.action.confirm":
          return actionConfirm(confirm, requester, args);
        case "oke.action.invoke":
          return actionInvoke(ctx, requester, args);
        case "oke.action.structural_propose":
          return actionStructural(ctx, requester, args);
        default:
          return {
            ok: false,
            code: "not-found",
            message: `unknown tool: ${name}`,
            data: asData({ tool: name }, "error"),
          };
      }
    },
  };
}

function okData<T>(
  content: T,
  provenance: Parameters<typeof asData>[1],
): ToolCallResult {
  return { ok: true, data: asData(content, provenance) };
}

function stripConfirmFields(
  args: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args)) {
    if (k === "confirmation" || k === "confirmToken" || k === "reason") {
      continue;
    }
    out[k] = v;
  }
  return out;
}

function schemaGet(
  ctx: McpContext,
  args: Record<string, unknown>,
): ToolCallResult {
  const flowId = String(args.flowId ?? "");
  const manifest = ctx.getManifest();
  const flow = manifest?.flows?.[flowId];
  if (!flow) {
    return {
      ok: false,
      code: "not-found",
      message: `unknown flow: ${flowId}`,
      data: asData({ flowId }, "error"),
    };
  }
  return okData(
    freezeData({
      flowId,
      in: flow.in ?? null,
      out: flow.out ?? null,
      errors: flow.errors ?? null,
    }),
    "schema",
  );
}

function effectsGet(
  ctx: McpContext,
  args: Record<string, unknown>,
): ToolCallResult {
  const flowId = String(args.flowId ?? "");
  const manifest = ctx.getManifest();
  const flow = manifest?.flows?.[flowId];
  if (!flow) {
    return {
      ok: false,
      code: "not-found",
      message: `unknown flow: ${flowId}`,
      data: asData({ flowId }, "error"),
    };
  }
  return okData(
    freezeData({ flowId, effects: flow.effects ?? {} }),
    "effects",
  );
}

async function tracesList(
  ctx: McpContext,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const limit =
    typeof args.limit === "number" && Number.isFinite(args.limit)
      ? Math.min(200, Math.max(1, Math.floor(args.limit)))
      : 50;
  const flowId =
    typeof args.flowId === "string" && args.flowId.length > 0
      ? args.flowId
      : null;
  const all = await ctx.listRuns();
  const filtered = flowId ? all.filter((r) => r.flow === flowId) : all;
  const runs = filtered.slice(0, limit).map(projectRun);
  return okData(freezeData({ runs }), "trace");
}

async function tracesGet(
  ctx: McpContext,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  const runId = String(args.runId ?? "");
  const all = await ctx.listRuns();
  const run = all.find((r) => r.id === runId);
  if (!run) {
    return {
      ok: false,
      code: "not-found",
      message: `unknown run: ${runId}`,
      data: asData({ runId }, "error"),
    };
  }
  // Provenance `store-record` marks user-supplied fields as untrusted.
  return okData(freezeData({ run: projectRun(run) }), "store-record");
}

function actionConfirm(
  confirm: ReturnType<typeof createConfirmationGate>,
  requester: McpRequester,
  args: Record<string, unknown>,
): ToolCallResult {
  const tool = String(args.tool ?? "");
  const reason = String(args.reason ?? "");
  const toolArgs =
    args.args !== null && typeof args.args === "object" && !Array.isArray(args.args)
      ? (args.args as Record<string, unknown>)
      : {};
  const issued = confirm.request({
    tool,
    args: toolArgs,
    principalId: requester.principalId,
    reason,
  });
  if ("error" in issued) {
    return {
      ok: false,
      code: "invalid",
      message: "reason must be at least 3 characters",
      data: asData({ error: issued.error }, "error"),
    };
  }
  return okData(
    {
      confirmToken: issued.token,
      tool: issued.tool,
      phrase: MCP_CONFIRM_PHRASE,
      expiresAt: issued.expiresAt,
      notice:
        "Present confirmToken + confirmation phrase on the write call. Tokens are single-use; there is no session consent cache.",
    },
    "action-result",
  );
}

async function actionInvoke(
  ctx: McpContext,
  requester: McpRequester,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  if (!ctx.invokeFlow) {
    return {
      ok: false,
      code: "forbidden",
      message: "invoke adapter not configured",
      data: asData({ tool: "oke.action.invoke" }, "error"),
    };
  }
  const flowId = String(args.flowId ?? "");
  const reason = String(args.reason ?? "");
  const result = await ctx.invokeFlow({
    flowId,
    body: args.body,
    operatorId: requester.principalId,
    reason,
  });
  return okData(freezeData({ result }), "action-result");
}

async function actionStructural(
  ctx: McpContext,
  requester: McpRequester,
  args: Record<string, unknown>,
): Promise<ToolCallResult> {
  if (!ctx.proposeStructural) {
    return {
      ok: false,
      code: "forbidden",
      message: "structural adapter not configured",
      data: asData({ tool: "oke.action.structural_propose" }, "error"),
    };
  }
  const result = await ctx.proposeStructural({
    title: String(args.title ?? ""),
    relativePath: String(args.relativePath ?? ""),
    contents: String(args.contents ?? ""),
    operatorId: requester.principalId,
    reason: String(args.reason ?? ""),
  });
  return okData(freezeData({ result }), "action-result");
}

/**
 * Project a wide event for MCP. Dimensions / logs may contain poisoned
 * strings — they remain in `content` under a store-record provenance.
 *
 * @param run - Wide event
 */
export function projectRun(run: WideEvent): Record<string, unknown> {
  return {
    id: run.id,
    parentId: run.parentId ?? null,
    flow: run.flow,
    unit: run.unit ?? null,
    trigger: run.trigger,
    plane: run.plane,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    durationMs: run.durationMs,
    error: run.error ?? null,
    cost: run.cost ?? null,
    effects: run.effects,
    // Attacker-controlled fields — still data, never instruction.
    logs: run.logs,
    dimensions: run.dimensions,
  };
}
