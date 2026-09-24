/**
 * AI runtime — prompts, agents (flow tools + gates), embeds, journaling.
 *
 * Nondeterministic ⇒ journaling forced, auto-cache disabled.
 * Schema-validation failures are their own class (console §9.10).
 * Agent denials are recorded on the denial ledger — not errors.
 * Tool invocations go through a caller-supplied `callTool` (host `fx.call`).
 */

import type { AiDriver, AiMessage, AiModelClient, AiToolDef } from "../../drivers/ai-types.ts";
import { currentAbortSignal, withAbortSignal } from "../../kernel/abort-scope.ts";
import { hasJournalLease, type JournalSession, type JournalStore } from "../../kernel/journal.ts";
import { isJournalSuspend } from "../../kernel/journal-suspend.ts";
import {
  AiDurableRequiredError,
  approvalId,
  approvalStepName,
  approvalTimeoutMs,
  readAgentApproval,
  resolveAgentApproval,
  type AgentApprovalDecision,
  type AgentApprovalRecord,
  type AgentApprovalResolveResult,
} from "./approval.ts";
import {
  mcpCapabilityRefFromName,
  mcpModelToolName,
  parseMcpToolRef,
} from "../../manifest/mcp-ref.ts";
import { createMcpClient, type McpClient } from "./mcp-client.ts";
import type { McpTransport } from "./mcp-transport.ts";
import type { IndexStore } from "../../drivers/types.ts";
import { maskRedactedDeep } from "../../kernel/redacted.ts";
import type { GatePolicyContext } from "../gate/declare.ts";
import type { GateRuntime } from "../gate/runtime.ts";
import type {
  AiAgentDecl,
  AiEmbedDecl,
  AiMcpServerDecl,
  AiModelDecl,
  AiPromptDecl,
  AiTimeout,
} from "./declare.ts";
import {
  isRetryableAiError,
  mergeAskAbortSignal,
  outExpectsVia,
  resolveTimeoutMs,
} from "./errors.ts";
import {
  createEventQueue,
  emitAssistantText,
  type AgentEventEmit,
  type AgUiEvent,
} from "./events.ts";
import { readModelTurn } from "./stream-turn.ts";
import {
  createMemoryAgentEventLog,
  setAgentEventLog,
  type AgentEventLog,
  type AgentRunHeader,
} from "./run-events.ts";
import { setAgentFollowGates } from "./approval-http.ts";
import { okid } from "../../okid.ts";
import { withSseId } from "../../kernel/sse-id.ts";
import {
  AiSchemaValidationError,
  coerceModelObject,
  promptOutJsonSchema,
  promptResponseFormat,
  validatePromptOut,
  type AiSchemaMismatch,
} from "./schema.ts";

/** Brief pause before the same-model retry on a retryable failure. */
const AI_SAME_MODEL_RETRY_BACKOFF_MS = 250;

/** Default bound for tool / agent loops. */
export const AI_DEFAULT_MAX_STEPS = 6;

/** Thrown inside the tool loop when a deny or abort ends the run. */
class AgentLoopHalt extends Error {
  readonly stopReason: "aborted" | "denied" | "error";
  readonly cause: unknown;
  readonly trail: readonly AgentToolStep[];
  readonly denials: readonly AgentDenial[];
  readonly steps: number;
  readonly cost: number;
  readonly output: unknown;

  constructor(
    stopReason: "aborted" | "denied" | "error",
    cause: unknown,
    partial: {
      readonly trail: readonly AgentToolStep[];
      readonly denials: readonly AgentDenial[];
      readonly steps: number;
      readonly cost: number;
      readonly output: unknown;
    },
  ) {
    super(cause instanceof Error ? cause.message : String(cause));
    this.name = stopReason === "aborted" ? "AbortError" : "AgentLoopHalt";
    this.stopReason = stopReason;
    this.cause = cause;
    this.trail = partial.trail;
    this.denials = partial.denials;
    this.steps = partial.steps;
    this.cost = partial.cost;
    this.output = partial.output;
  }
}

/** Console observability cap for ask journal entries and agent run records. */
export const AI_OBSERVABILITY_LIMIT = 500;

/**
 * Keep the newest entries. Older rows are observability, not storage.
 *
 * @param buf - Mutable ring
 * @param item - Entry to append
 */
function pushObservability<T>(buf: T[], item: T): void {
  buf.push(item);
  if (buf.length > AI_OBSERVABILITY_LIMIT) buf.shift();
}

/**
 * Split `name` / `name@version` the same way capability pins do.
 *
 * @param ref - Prompt id from `fx.ask`
 */
export function parsePromptRef(ref: string): {
  readonly name: string;
  readonly version?: number;
} {
  const at = ref.lastIndexOf("@");
  if (at <= 0) return { name: ref };
  const tail = ref.slice(at + 1);
  if (!/^\d+$/.test(tail)) return { name: ref };
  return { name: ref.slice(0, at), version: Number(tail) };
}

/** Why an agent loop stopped. A fed-back denial is not `denied`. */
export type AgentStopReason = "completed" | "max_steps" | "budget" | "denied" | "aborted" | "error";

/** Recorded agent tool denial (containment proof — not an error). */
export interface AgentDenial {
  readonly agent: string;
  readonly tool: string;
  readonly gate: string;
  readonly reason: string;
  readonly at: number;
}

/** Effect on a tool flow — same vocabulary as Flows / Traces. */
export interface AgentToolEffect {
  readonly kind: "read" | "write" | "emit" | "send" | "ask" | "embed" | "secret" | "call";
  readonly resource: string;
}

/**
 * One tool-call line in an agent run.
 * Denied calls are status `"denied"` — never classified as errors.
 */
export interface AgentToolStep {
  readonly tool: string;
  readonly status: "ok" | "denied";
  readonly effects: readonly AgentToolEffect[];
  readonly denial?: AgentDenial;
  readonly at: number;
  /** Who approved this tool, when a human resolution ran it. */
  readonly approver?: string;
}

/** Full agent run recorded on the denial / trail ledger. */
export interface AgentRunRecord {
  readonly id: string;
  readonly agent: string;
  readonly message: string;
  readonly ok: boolean;
  readonly stopReason: AgentStopReason;
  readonly steps: number;
  readonly trail: readonly AgentToolStep[];
  readonly denials: readonly AgentDenial[];
  readonly output?: unknown;
  readonly at: number;
  readonly cost: number;
  /** Parent agent run, when this run is a nested tool. */
  readonly parentRunId?: string;
  /** Message when {@link stopReason} is `error`. */
  readonly error?: string;
  /** AG-UI thread, when the run opened a follow log. */
  readonly threadId?: string;
  /** Epoch ms the run finished. Absent while it is still open. */
  readonly finishedAt?: number;
  /** Driver-reported input tokens. Omitted when the driver did not supply them. */
  readonly inputTokens?: number;
  /** Driver-reported output tokens. Omitted when the driver did not supply them. */
  readonly outputTokens?: number;
}

/** Fallback attempt for model routing (`via` chains). */
export interface AiFallbackAttempt {
  readonly model: string;
  readonly ok: boolean;
  readonly error?: string;
  readonly cost?: number;
  readonly latencyMs?: number;
  readonly at: number;
}

/** Ask outcome class — schema failure is not a provider error. */
export type AiAskOutcome = "ok" | "provider_error" | "schema_invalid" | "budget_exceeded";

/** Journal entry for a nondeterministic ask. */
export interface AiJournalEntry {
  readonly prompt: string;
  readonly version?: number;
  readonly input: unknown;
  readonly output: unknown;
  readonly attempts: readonly AiFallbackAttempt[];
  readonly outcome: AiAskOutcome;
  readonly cost: number;
  readonly latencyMs: number;
  /** Driver-reported input tokens (omitted when the driver did not supply them). */
  readonly inputTokens?: number;
  /** Driver-reported output tokens (omitted when the driver did not supply them). */
  readonly outputTokens?: number;
  readonly schemaMismatch?: AiSchemaMismatch;
  readonly at: number;
}

/** Optional token counts from a complete() / tool-loop usage bag. */
type UsageTokens = {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
};

/**
 * Copy driver token fields when they are numbers — never invent counts.
 *
 * @param usage - Complete / loop usage
 */
function tokenFields(usage: UsageTokens | undefined): UsageTokens {
  return {
    ...(typeof usage?.inputTokens === "number" ? { inputTokens: usage.inputTokens } : {}),
    ...(typeof usage?.outputTokens === "number" ? { outputTokens: usage.outputTokens } : {}),
  };
}

/**
 * Add one complete() usage onto running token totals.
 *
 * @param acc - Mutable totals
 * @param usage - Driver usage
 */
function addUsageTokens(
  acc: { inputTokens?: number; outputTokens?: number },
  usage: UsageTokens | undefined,
): void {
  if (typeof usage?.inputTokens === "number") {
    acc.inputTokens = (acc.inputTokens ?? 0) + usage.inputTokens;
  }
  if (typeof usage?.outputTokens === "number") {
    acc.outputTokens = (acc.outputTokens ?? 0) + usage.outputTokens;
  }
}

/** Options for {@link createAiRuntime}. */
export interface CreateAiRuntimeOptions {
  readonly models?: readonly AiModelDecl[];
  readonly prompts?: readonly AiPromptDecl[];
  readonly agents?: readonly AiAgentDecl[];
  readonly embeds?: readonly AiEmbedDecl[];
  /**
   * Model name → opened client (or driver used to open).
   * When a driver is provided, it is opened once at construction.
   */
  readonly clients?: Readonly<Record<string, AiModelClient>>;
  /** Default driver when a model has no client (usually mock in dev). */
  readonly defaultDriver?: AiDriver;
  /**
   * Protocol drivers keyed by id — used when a logical model sets
   * {@link AiModelDecl.driverId} instead of the app default.
   */
  readonly drivers?: Readonly<Record<string, AiDriver>>;
  /** Gate runtime for agent tool calls. */
  readonly gates?: GateRuntime;
  /**
   * Invoke a flow by name (agent tools / boot fallback). Prefer per-ask
   * `callTool` from the host `fx.call` so caller capability applies.
   *
   * @param name - Flow name
   * @param input - Tool input
   */
  readonly callFlow?: (name: string, input: unknown) => Promise<unknown>;
  /** Journal store that holds pending tool approvals. */
  readonly journalStore?: JournalStore;
  /** Event log for follow / resume. Defaults to an in-memory log. */
  readonly eventLog?: AgentEventLog;
  /**
   * Resolve gates required for a tool flow.
   *
   * @param flowName - Flow name
   */
  readonly gatesForFlow?: (flowName: string) => readonly string[];
  /**
   * Resolve declared effects for a tool flow (Manifest).
   *
   * @param flowName - Flow name
   */
  readonly effectsForFlow?: (flowName: string) => readonly AgentToolEffect[];
  /**
   * Resolve tool JSON-schema parameters for a flow (defaults to empty object).
   *
   * @param flowName - Flow name
   */
  readonly toolSchemaForFlow?: (flowName: string) => unknown;
  /** Index stores for embeds (`into` name → store). */
  readonly indexes?: Readonly<Record<string, IndexStore>>;
  /** Injectable clock. */
  readonly now?: () => number;
  /**
   * When true (default), asks are journaled and auto-cache is disabled.
   * Nondeterministic contract.
   */
  readonly forceJournal?: boolean;
  /** Declared external MCP servers. */
  readonly mcpServers?: readonly AiMcpServerDecl[];
  /** Resolve a vault secret by contract name (MCP bearer). */
  readonly resolveSecret?: (name: string) => string | Promise<string>;
  /** Injected MCP transports keyed by server name (tests). */
  readonly mcpTransports?: Readonly<Record<string, McpTransport>>;
}

/** Ask options. */
export interface AiAskOptions {
  readonly via?: readonly string[];
  /** Per-call deadline — overrides prompt `timeout` (`"30s"` or ms). */
  readonly timeout?: AiTimeout;
  readonly allowPii?: boolean;
  /** Flow names offered as tools — each model call dispatches via `callTool`. */
  readonly tools?: readonly string[];
  /** Bound on tool invocations (default {@link AI_DEFAULT_MAX_STEPS}). */
  readonly maxSteps?: number;
  /**
   * Host-flow dispatch — must be `fx.call` so capability + Runs apply.
   * Falls back to runtime `callFlow` when omitted.
   */
  readonly callTool?: (name: string, input: unknown) => Promise<unknown>;
  /** Yield AG-UI events instead of returning the validated object. */
  readonly stream?: boolean;
}

/** Agent run options. */
export interface AiAgentRunOptions {
  /** Single user turn. Mutually exclusive with {@link messages}. */
  readonly message?: string;
  /** Prior user, assistant, and tool turns. Mutually exclusive with {@link message}. */
  readonly messages?: readonly AiMessage[];
  readonly auth?: GatePolicyContext["auth"];
  readonly operator?: GatePolicyContext["operator"];
  readonly meta?: GatePolicyContext["meta"];
  /** Host-flow dispatch — must be `fx.call` when wired from fx.run. */
  readonly callTool?: (name: string, input: unknown) => Promise<unknown>;
  /** Durable journal when the calling Flow is `durable: true`. */
  readonly journal?: JournalSession;
  /** Calling flow name, used when approval requires durability. */
  readonly flow?: string;
  readonly tenantId?: string | null;
  /** This run's id. Nested tools stamp it as `parentRunId`. */
  readonly runId?: string;
  /** Parent agent run id. */
  readonly parentRunId?: string;
  /** 1-based nest level. Default 1. */
  readonly depth?: number;
  /** Cost cap for this invocation. Wins over the agent's own budget. */
  readonly maxCostPerRun?: number;
  /** Record a `call` effect on the host ledger when a child agent starts. */
  readonly recordCall?: (name: string) => void | Promise<void>;
  /** AG-UI thread. Defaults to a unique id. */
  readonly threadId?: string;
  /** Non-public gates on the calling Flow. */
  readonly gates?: readonly string[];
  /** Starting `auth.userId`. */
  readonly userId?: string | null;
  /** Starting operator id. */
  readonly operatorId?: string | null;
}

/** Stream options. */
export interface AiStreamOptions {
  readonly prompt?: string;
  readonly data?: unknown;
  readonly signal?: AbortSignal;
  /** Ordered fallback models after the primary `stream(model)` name. */
  readonly via?: readonly string[];
}

/** AI runtime surface. */
export interface AiRuntime {
  readonly prompts: ReadonlyMap<string, AiPromptDecl>;
  readonly agents: ReadonlyMap<string, AiAgentDecl>;
  readonly embeds: ReadonlyMap<string, AiEmbedDecl>;
  /** Whether auto-cache is disabled (always true for AI). */
  readonly autoCacheDisabled: true;
  /** Whether journaling is forced for asks. */
  readonly journalingForced: boolean;
  /** Agent denials recorded this process (the denial ledger). */
  readonly denials: readonly AgentDenial[];
  /** Agent runs with full tool trails. */
  readonly agentRuns: readonly AgentRunRecord[];
  /** Ask results kept for Console (last {@link AI_OBSERVABILITY_LIMIT}). Not a replay cache. */
  readonly journal: readonly AiJournalEntry[];
  /**
   * Egress identity from the most recent ask / embed / stream complete.
   * Used by `fx.ask` / `fx.embed` to stamp {@link EffectEntry.external}.
   */
  lastExternal?: import("../../drivers/external.ts").DriverExternal;
  /**
   * Ask a prompt with optional model fallback chain and optional tools.
   *
   * @param prompt - Prompt name
   * @param input - Prompt input
   * @param opts - via / tools / callTool / allowPii
   */
  ask(prompt: string, input?: unknown, opts?: AiAskOptions): Promise<Record<string, unknown>>;
  /**
   * Ask and yield AG-UI events. Tool-less asks still throw on budget inside the stream.
   *
   * @param prompt - Prompt name
   * @param input - Prompt input
   * @param opts - via / tools / callTool
   */
  streamAsk(prompt: string, input?: unknown, opts?: AiAskOptions): AsyncIterable<AgUiEvent>;
  /**
   * Run a bounded agent; tool calls that fail gates are denied + recorded.
   *
   * @param agent - Agent name
   * @param options - Message + auth context
   */
  runAgent(
    agent: string,
    options: AiAgentRunOptions,
  ): Promise<{
    readonly ok: boolean;
    readonly stopReason: AgentStopReason;
    readonly steps: number;
    readonly denials: readonly AgentDenial[];
    readonly trail: readonly AgentToolStep[];
    readonly output?: unknown;
    readonly cost: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  }>;
  /**
   * Run an agent and yield AG-UI events.
   *
   * @param agent - Agent name
   * @param options - Message + auth context
   */
  streamAgent(agent: string, options: AiAgentRunOptions): AsyncIterable<AgUiEvent>;
  /**
   * Stream model tokens (real driver stream; fails loud if unsupported).
   *
   * @param model - Model name
   * @param options - Prompt / data / signal
   */
  stream(model: string, options?: AiStreamOptions): AsyncIterable<string>;
  /**
   * Call an allowlisted MCP tool (`mcp:<server>/<tool>`).
   *
   * @param ref - Capability ref
   * @param input - Tool arguments
   * @param signal - Cancel
   */
  callMcp(ref: string, input: unknown, signal?: AbortSignal): Promise<unknown>;
  /**
   * Embed text into the configured index store.
   *
   * @param embed - Embed name
   * @param id - Document id
   * @param text - Text to embed
   */
  embed(embed: string, id: string, text: string): Promise<void>;
  /**
   * Produce an embedding vector for text via a named model (no index write).
   * Used by built-in hybrid search (`fx.embed`) and the system embed CDC flow.
   *
   * @param model - Model name
   * @param text - Text to embed
   */
  embedVector(model: string, text: string): Promise<readonly number[]>;
  /**
   * Approve or deny a pending tool. First resolution wins.
   *
   * @param id - Approval id
   * @param decision - Approve or deny
   * @param ctx - Gate context for the tool's gate
   */
  resolveApproval(
    id: string,
    decision: AgentApprovalDecision,
    ctx: GatePolicyContext,
  ): Promise<AgentApprovalResolveResult>;
}

/**
 * Build provider-facing prompt text — Redacted values become placeholders.
 *
 * @param input - Ask input or stream data
 */
export function promptContentFromInput(input: unknown): string {
  const masked = maskRedactedDeep(input);
  if (typeof masked === "string") return masked;
  return JSON.stringify(masked ?? {});
}

/**
 * Initial model messages for an agent run.
 *
 * @param runOpts - Single message or a history
 */
function agentMessages(runOpts: AiAgentRunOptions): AiMessage[] {
  if (runOpts.message !== undefined && runOpts.messages !== undefined) {
    throw new TypeError("fx.run: pass message or messages, not both");
  }
  if (runOpts.messages !== undefined) return [...runOpts.messages];
  return [{ role: "user", content: promptContentFromInput(runOpts.message ?? "") }];
}

const agentRunSlots = new WeakMap<JournalSession, { epoch: number; slot: number }>();

/**
 * Run id for one agent invocation. A durable Flow journals the id so two
 * streamed runs in the same Flow do not share a log, and a replay keeps it.
 *
 * @param agent - Agent name
 * @param runOpts - Run options
 */
async function allocateAgentRunId(agent: string, runOpts: AiAgentRunOptions): Promise<string> {
  if (runOpts.runId) return runOpts.runId;
  const journal = runOpts.journal;
  if (!journal) return okid();
  const epoch = journal.epoch;
  const prev = agentRunSlots.get(journal);
  const next = prev && prev.epoch === epoch ? prev.slot + 1 : 1;
  agentRunSlots.set(journal, { epoch, slot: next });
  const stored = await journal.effect("ask", `oke.agent.run.${agent}.${next}`, () => okid());
  return typeof stored === "string" ? stored : okid();
}

/**
 * Principal and gates stored on the follow log.
 *
 * @param runId - Agent run id
 * @param threadId - AG-UI thread
 * @param runOpts - Run options
 */
function agentLogHeader(
  runId: string,
  threadId: string,
  agent: string,
  runOpts: AiAgentRunOptions,
): AgentRunHeader {
  return {
    runId,
    threadId,
    agent,
    ...(runOpts.parentRunId !== undefined ? { parentRunId: runOpts.parentRunId } : {}),
    tenant: runOpts.tenantId ?? null,
    gates: runOpts.gates ?? [],
    userId: runOpts.userId ?? runOpts.auth?.userId ?? null,
    operatorId: runOpts.operatorId ?? runOpts.operator?.id ?? null,
  };
}

/**
 * Ledger label for a run that may be a history rather than one string.
 *
 * @param runOpts - Single message or a history
 */
function agentMessageLabel(runOpts: AiAgentRunOptions): string {
  if (typeof runOpts.message === "string") return runOpts.message;
  const lastUser = [...(runOpts.messages ?? [])]
    .reverse()
    .find((message) => message.role === "user");
  return lastUser?.content ?? "";
}

function askUserContent(input: unknown, out: unknown): string {
  const base = promptContentFromInput(input);
  const schema = promptOutJsonSchema(out);
  if (!schema) return base;
  return `${base}\nReply with JSON only matching this schema: ${JSON.stringify(schema)}`;
}

/**
 * Create an AI runtime.
 *
 * @param options - Declarations + clients + gates
 */
export function createAiRuntime(options: CreateAiRuntimeOptions = {}): AiRuntime {
  const prompts = new Map<string, AiPromptDecl>();
  for (const p of options.prompts ?? []) prompts.set(p.name, p);
  const agents = new Map<string, AiAgentDecl>();
  for (const a of options.agents ?? []) agents.set(a.name, a);
  const embeds = new Map<string, AiEmbedDecl>();
  for (const e of options.embeds ?? []) embeds.set(e.name, e);
  const models = new Map<string, AiModelDecl>();
  for (const m of options.models ?? []) models.set(m.name, m);

  const clients = new Map<string, AiModelClient>(Object.entries(options.clients ?? {}));
  const eventStore = options.journalStore?.agentEvents;
  const eventLog =
    options.eventLog ??
    createMemoryAgentEventLog(eventStore, {
      claim: async (runId) => {
        const journal = options.journalStore;
        if (journal && hasJournalLease(journal)) {
          const row = await journal.get(runId);
          if (row) {
            return journal.acquireLease(runId, "agent-events", Date.now(), 30_000);
          }
        }
        return (await eventStore?.claim(runId)) ?? true;
      },
    });
  setAgentEventLog(eventLog);
  setAgentFollowGates(options.gates);
  const mcpClient: McpClient = createMcpClient({
    servers: options.mcpServers,
    ...(options.resolveSecret !== undefined ? { resolveSecret: options.resolveSecret } : {}),
    ...(options.mcpTransports !== undefined ? { transports: options.mcpTransports } : {}),
  });
  const denials: AgentDenial[] = [];
  const agentRuns: AgentRunRecord[] = [];
  const journal: AiJournalEntry[] = [];
  const now = options.now ?? (() => Date.now());
  const noteAppendFailure = (
    runId: string,
    agentName: string,
    label: string,
    err: unknown,
  ): void => {
    const message = err instanceof Error ? err.message : String(err);
    pushObservability(agentRuns, {
      id: runId,
      agent: agentName,
      message: label,
      ok: false,
      stopReason: "error",
      error: message,
      steps: 0,
      trail: [],
      denials: [],
      at: now(),
      cost: 0,
    });
  };
  const journalingForced = options.forceJournal !== false;
  let runSeq = 0;
  /** Mutable egress stamp shared by ask / embed / toolLoop. */
  const egress: {
    lastExternal?: import("../../drivers/external.ts").DriverExternal;
  } = {};

  async function clientFor(name: string): Promise<AiModelClient> {
    const existing = clients.get(name);
    if (existing) return existing;
    const model = models.get(name);
    const driver =
      (model?.driverId !== undefined ? options.drivers?.[model.driverId] : undefined) ??
      options.defaultDriver;
    if (!driver) {
      throw new Error(
        model?.driverId
          ? `ai: no driver "${model.driverId}" for model "${name}" and no defaultDriver`
          : `ai: no client for model "${name}" and no defaultDriver`,
      );
    }
    const externalOpen = aiOpenExternal(model);
    const opened = await driver.open({
      model: model?.model ?? name,
      ...(model?.baseUrl !== undefined ? { baseUrl: model.baseUrl } : {}),
      ...(model?.apiKey !== undefined ? { apiKey: model.apiKey } : {}),
      ...(externalOpen !== undefined ? { external: externalOpen } : {}),
    });
    clients.set(name, opened);
    return opened;
  }

  /**
   * Declare-time egress classification for a model binding (never hostname regex).
   *
   * @param model - Model declaration
   */
  function aiOpenExternal(
    model: AiModelDecl | undefined,
  ): { kind: "third-party" | "infrastructure"; provider?: string } | undefined {
    if (!model) return undefined;
    const provider = model.provider?.toLowerCase();
    if (model.driverId === "mock" || provider === "mock") return undefined;
    if (provider === "local") {
      return { kind: "infrastructure", provider: "local" };
    }
    if (model.driverId === "anthropic") {
      return { kind: "third-party", provider: provider ?? "anthropic" };
    }
    return {
      kind: "third-party",
      ...(provider !== undefined ? { provider } : {}),
    };
  }

  /** Wire model id for a logical binding (never send the binding name to providers). */
  function wireModel(logicalName: string, client: AiModelClient): string {
    return models.get(logicalName)?.model ?? client.model;
  }

  function effectsFor(tool: string): readonly AgentToolEffect[] {
    return options.effectsForFlow?.(tool) ?? [];
  }

  async function toolDefsFor(toolNames: readonly string[]): Promise<AiToolDef[]> {
    const defs: AiToolDef[] = [];
    for (const name of toolNames) {
      const mcp = parseMcpToolRef(name);
      if (mcp) {
        const listed = await mcpClient.listedTool(mcp);
        defs.push({
          name: mcpModelToolName(mcp.server, mcp.tool),
          description: listed?.description ?? `MCP tool: ${mcp.server}/${mcp.tool}`,
          parameters: listed?.inputSchema ?? { type: "object", properties: {} },
        });
        continue;
      }
      defs.push({
        name,
        description: `Flow tool: ${name}`,
        parameters: options.toolSchemaForFlow?.(name) ?? { type: "object", properties: {} },
      });
    }
    return defs;
  }

  let self: AiRuntime;

  async function dispatchTool(opts: {
    readonly tool: string;
    readonly args: unknown;
    readonly agentLabel: string;
    readonly allowedTools: ReadonlySet<string>;
    readonly callTool?: (name: string, input: unknown) => Promise<unknown>;
    readonly auth?: GatePolicyContext["auth"];
    readonly operator?: GatePolicyContext["operator"];
    readonly meta?: GatePolicyContext["meta"];
    readonly trail: AgentToolStep[];
    readonly runDenials: AgentDenial[];
    readonly signal?: AbortSignal;
    readonly callId?: string;
    readonly step?: number;
    readonly index?: number;
    readonly threadId?: string;
    readonly journal?: JournalSession;
    readonly flow?: string;
    readonly tenantId?: string | null;
    readonly approvals?: AiAgentDecl["approvals"];
    readonly emit?: AgentEventEmit;
    readonly runId?: string;
    readonly depth?: number;
    readonly maxCostPerRun?: number;
    readonly spent?: number;
    readonly recordCall?: (name: string) => void | Promise<void>;
    readonly spend?: { cost: number; inputTokens?: number; outputTokens?: number };
  }): Promise<unknown> {
    const {
      tool,
      args,
      agentLabel,
      allowedTools,
      callTool,
      auth,
      operator,
      meta,
      trail,
      runDenials,
      signal,
    } = opts;
    const capability = mcpCapabilityRefFromName(tool) ?? tool;
    const effects = effectsFor(capability);

    if (!allowedTools.has(tool) && !allowedTools.has(capability)) {
      const denial: AgentDenial = {
        agent: agentLabel,
        tool,
        gate: "(unknown-tool)",
        reason: `tool "${tool}" was not offered`,
        at: now(),
      };
      runDenials.push(denial);
      denials.push(denial);
      trail.push({ tool, status: "denied", effects, denial, at: denial.at });
      const unknown = new Error(`ai: model requested unknown tool "${tool}"`);
      unknown.name = "AgentDenied";
      throw unknown;
    }

    const requiredGates = options.gatesForFlow?.(capability) ?? [];
    if (requiredGates.length > 0 && options.gates) {
      const ctx: GatePolicyContext = {
        auth: auth ?? { userId: null, scopes: new Set() },
        operator: operator ?? { id: null },
        meta,
      };
      const evaluations = await options.gates.check(requiredGates, ctx);
      const denied = evaluations.find((e) => !e.allowed);
      if (denied) {
        const denial: AgentDenial = {
          agent: agentLabel,
          tool,
          gate: denied.name,
          reason: denied.reason ?? "gate denied",
          at: now(),
        };
        runDenials.push(denial);
        denials.push(denial);
        trail.push({ tool, status: "denied", effects, denial, at: denial.at });
        return { error: denial.reason, denied: true };
      }
    }

    const approval = opts.approvals?.[capability] ?? opts.approvals?.[tool];
    const needsApproval =
      approval !== undefined &&
      (approval.when === undefined || approval.when(args, { auth, tenant: opts.tenantId ?? null }));
    if (needsApproval) {
      if (!opts.journal) {
        throw new AiDurableRequiredError(opts.flow ?? "(unknown)", agentLabel);
      }
      const toolCallId =
        opts.callId && opts.callId.length > 0
          ? opts.callId
          : `${agentLabel}:${opts.step ?? 0}:${opts.index ?? 0}`;
      const id = approvalId(opts.journal.runId, toolCallId);
      const record: AgentApprovalRecord = {
        status: "pending",
        agent: agentLabel,
        tool: capability,
        args,
        gate: approval.gate,
        tenant: opts.tenantId ?? null,
        requestedAt: now(),
      };
      const stored = (await opts.journal.step(
        approvalStepName(id),
        () => record,
      )) as AgentApprovalRecord;
      let decision = stored;
      if (decision.status === "pending") {
        opts.emit?.({
          type: "RUN_FINISHED",
          threadId: opts.threadId ?? opts.runId ?? opts.journal.runId,
          runId: opts.runId ?? opts.journal.runId,
          outcome: {
            type: "interrupt",
            interrupts: [{ id, reason: "approval", payload: { tool: capability, args } }],
          },
        });
        await opts.journal.sleep(approvalStepName(id), approval.timeout, () =>
          approvalTimeoutMs(approval.timeout),
        );
        const store = options.journalStore;
        if (!store) throw new Error("ai: approval resume requires a journal store");
        decision = (await readAgentApproval(store, id)) ?? decision;
        if (decision.status === "pending") {
          const wrote = await resolveAgentApproval(
            store,
            id,
            { decision: "deny", reason: "timeout", tenant: decision.tenant },
            now,
            opts.journal.run.lockedBy,
          );
          decision = wrote.ok
            ? { ...decision, status: "denied", reason: "timeout" }
            : ((await readAgentApproval(store, id)) ?? decision);
        }
      }
      if (decision.status === "denied") {
        const denial: AgentDenial = {
          agent: agentLabel,
          tool: capability,
          gate: approval.gate,
          reason: decision.reason ?? "denied",
          at: now(),
        };
        runDenials.push(denial);
        denials.push(denial);
        trail.push({ tool: capability, status: "denied", effects, denial, at: denial.at });
        return { denied: true, reason: denial.reason };
      }
      const toolArgs = decision.editedArgs !== undefined ? decision.editedArgs : args;
      const output = await opts.journal.effect("call", approvalStepName(id), () => {
        const call = callTool ?? options.callFlow;
        if (!call) throw new Error("callFlow not configured");
        return withAbortSignal(signal ?? currentAbortSignal(), () => call(capability, toolArgs));
      });
      trail.push({
        tool: capability,
        status: "ok",
        effects,
        at: now(),
        ...(decision.approver !== undefined ? { approver: decision.approver } : {}),
      });
      return output;
    }

    const childDecl = agents.get(capability) ?? agents.get(tool);
    if (childDecl && self) {
      const depth = opts.depth ?? 1;
      const parentLimit = agents.get(agentLabel)?.maxDepth ?? 3;
      if (depth >= parentLimit) {
        return { error: `ai: agent "${agentLabel}" is nested past maxDepth ${parentLimit}` };
      }
      const childId = okid();
      opts.emit?.({
        type: "CUSTOM",
        name: "oke.subagent.started",
        value: { runId: childId, parentToolCallId: opts.callId },
      });
      await opts.recordCall?.(childDecl.name);
      const parentRemaining =
        opts.maxCostPerRun !== undefined ? opts.maxCostPerRun - (opts.spent ?? 0) : undefined;
      const childCap = childDecl.budget?.maxCostPerRun;
      const cap =
        parentRemaining !== undefined
          ? childCap !== undefined
            ? Math.min(childCap, parentRemaining)
            : parentRemaining
          : childCap;
      try {
        const child = await self.runAgent(childDecl.name, {
          message: typeof args === "string" ? args : JSON.stringify(args ?? {}),
          runId: childId,
          parentRunId: opts.runId,
          depth: depth + 1,
          ...(cap !== undefined ? { maxCostPerRun: cap } : {}),
          ...(callTool !== undefined ? { callTool } : {}),
          ...(auth !== undefined ? { auth } : {}),
          ...(operator !== undefined ? { operator } : {}),
          ...(meta !== undefined ? { meta } : {}),
          ...(opts.journal !== undefined ? { journal: opts.journal } : {}),
          ...(opts.flow !== undefined ? { flow: opts.flow } : {}),
          ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
          ...(opts.recordCall !== undefined ? { recordCall: opts.recordCall } : {}),
        });
        if (opts.spend) {
          opts.spend.cost += child.cost;
          opts.spend.inputTokens = (opts.spend.inputTokens ?? 0) + (child.inputTokens ?? 0);
          opts.spend.outputTokens = (opts.spend.outputTokens ?? 0) + (child.outputTokens ?? 0);
        }
        opts.emit?.({
          type: "CUSTOM",
          name: "oke.subagent.finished",
          value: { runId: childId, parentToolCallId: opts.callId },
        });
        trail.push({ tool: capability, status: "ok", effects, at: now() });
        return child.output ?? child;
      } catch (err) {
        opts.emit?.({
          type: "CUSTOM",
          name: "oke.subagent.error",
          value: { runId: childId, parentToolCallId: opts.callId },
        });
        throw err;
      }
    }

    const invoke = callTool ?? options.callFlow;
    if (!invoke) {
      const denial: AgentDenial = {
        agent: agentLabel,
        tool,
        gate: "(no-callFlow)",
        reason: "callFlow not configured",
        at: now(),
      };
      runDenials.push(denial);
      denials.push(denial);
      trail.push({ tool, status: "denied", effects, denial, at: denial.at });
      return { error: denial.reason, denied: true };
    }

    const invokeSignal = signal ?? currentAbortSignal();
    const output = await withAbortSignal(invokeSignal, () => invoke(capability, args));
    trail.push({ tool: capability, status: "ok", effects, at: now() });
    return output;
  }

  async function toolLoop(opts: {
    readonly client: AiModelClient;
    readonly modelName: string;
    readonly messages: AiMessage[];
    readonly tools: readonly string[];
    readonly maxSteps: number;
    /** Stop before the next model call once accumulated cost reaches this cap. */
    readonly maxCostPerRun?: number;
    readonly agentLabel: string;
    readonly responseFormat?: unknown;
    readonly signal?: AbortSignal;
    readonly callTool?: (name: string, input: unknown) => Promise<unknown>;
    readonly auth?: GatePolicyContext["auth"];
    readonly operator?: GatePolicyContext["operator"];
    readonly meta?: GatePolicyContext["meta"];
    readonly emit?: AgentEventEmit;
    readonly journal?: JournalSession;
    readonly flow?: string;
    readonly tenantId?: string | null;
    readonly approvals?: AiAgentDecl["approvals"];
    readonly runId?: string;
    readonly threadId?: string;
    readonly depth?: number;
    readonly recordCall?: (name: string) => void | Promise<void>;
  }): Promise<{
    readonly output: unknown;
    readonly text: string;
    readonly raw: unknown;
    readonly lastToolResult: unknown;
    readonly trail: AgentToolStep[];
    readonly denials: AgentDenial[];
    readonly steps: number;
    readonly cost: number;
    readonly budgetExceeded: boolean;
    readonly stopReason: AgentStopReason;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
  }> {
    const messages = [...opts.messages];
    const defs = await toolDefsFor(opts.tools);
    const allowed = new Set(opts.tools);
    for (const name of opts.tools) {
      const mcp = parseMcpToolRef(name);
      if (mcp) allowed.add(mcpModelToolName(mcp.server, mcp.tool));
    }
    const trail: AgentToolStep[] = [];
    const runDenials: AgentDenial[] = [];
    let steps = 0;
    let cost = 0;
    let budgetExceeded = false;
    let stopReason: AgentStopReason = "max_steps";
    const tokens: { inputTokens?: number; outputTokens?: number } = {};
    let lastText = "";
    let lastRaw: unknown = {};
    let lastToolResult: unknown;
    let messageSeq = 0;

    const capHit = (): boolean => opts.maxCostPerRun !== undefined && cost >= opts.maxCostPerRun;

    const finish = () => ({
      output: lastToolResult !== undefined ? lastToolResult : lastRaw,
      text: lastText,
      raw: lastRaw,
      lastToolResult,
      trail,
      denials: runDenials,
      steps,
      cost,
      budgetExceeded,
      stopReason,
      ...tokenFields(tokens),
    });

    const providerModel = wireModel(opts.modelName, opts.client);
    while (steps < opts.maxSteps) {
      if (opts.signal?.aborted) {
        stopReason = "aborted";
        throw new AgentLoopHalt("aborted", new Error("aborted"), {
          trail,
          denials: runDenials,
          steps,
          cost,
          output: lastToolResult !== undefined ? lastToolResult : lastRaw,
        });
      }
      if (capHit()) {
        budgetExceeded = true;
        stopReason = "budget";
        return finish();
      }
      const stepName = `step-${steps + 1}`;
      opts.emit?.({ type: "STEP_STARTED", stepName });
      let result: Awaited<ReturnType<AiModelClient["complete"]>>;
      let streamedLive = false;
      let executed = false;
      try {
        const produce = async () => {
          executed = true;
          const turn = await readModelTurn(
            opts.client,
            {
              model: providerModel,
              messages,
              tools: defs.length > 0 ? defs : undefined,
              responseFormat: opts.responseFormat,
              ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
            },
            opts.emit,
            () => `m-${++messageSeq}`,
          );
          streamedLive = turn.streamed;
          return turn.result;
        };
        result = opts.journal
          ? await opts.journal.effect("ask", `${opts.agentLabel}:${steps}`, produce)
          : await produce();
      } catch (err) {
        if (err instanceof AgentLoopHalt) throw err;
        if (err instanceof Error && err.name === "AbortError") {
          throw new AgentLoopHalt("aborted", err, {
            trail,
            denials: runDenials,
            steps,
            cost,
            output: lastToolResult !== undefined ? lastToolResult : lastRaw,
          });
        }
        throw err;
      }
      if (result.external !== undefined) {
        egress.lastExternal = result.external;
      }
      cost += result.usage?.cost ?? 0;
      addUsageTokens(tokens, result.usage);
      lastText = result.text;
      lastRaw = result.raw !== undefined ? result.raw : result.text;
      const replayed = opts.journal !== undefined && !executed;
      const messageId = streamedLive || replayed ? "" : `m-${++messageSeq}`;
      const emittedText =
        streamedLive || replayed
          ? false
          : emitAssistantText(opts.emit ?? (() => undefined), messageId, result.text);
      if (capHit()) {
        budgetExceeded = true;
        stopReason = "budget";
        opts.emit?.({ type: "STEP_FINISHED", stepName });
        return finish();
      }

      const toolCalls = result.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        opts.emit?.({ type: "STEP_FINISHED", stepName });
        stopReason = "completed";
        return finish();
      }

      messages.push({
        role: "assistant",
        content: result.text || "",
        toolCalls,
      });

      for (const [index, tc] of toolCalls.entries()) {
        if (steps >= opts.maxSteps) break;
        steps++;
        const callId = tc.id.length > 0 ? tc.id : `${opts.agentLabel}:${steps}:${index}`;
        if (!streamedLive && !replayed) {
          opts.emit?.({
            type: "TOOL_CALL_START",
            toolCallId: callId,
            toolCallName: tc.name,
            ...(emittedText ? { parentMessageId: messageId } : {}),
          });
          opts.emit?.({
            type: "TOOL_CALL_ARGS",
            toolCallId: callId,
            delta: JSON.stringify(tc.arguments ?? {}),
          });
          opts.emit?.({ type: "TOOL_CALL_END", toolCallId: callId });
        }
        let toolResult: unknown;
        const spend = { cost: 0, inputTokens: 0, outputTokens: 0 };
        try {
          toolResult = await dispatchTool({
            tool: tc.name,
            args: tc.arguments,
            agentLabel: opts.agentLabel,
            allowedTools: allowed,
            callTool: opts.callTool,
            auth: opts.auth,
            operator: opts.operator,
            meta: opts.meta,
            trail,
            runDenials,
            callId,
            step: steps,
            index,
            ...(opts.threadId !== undefined ? { threadId: opts.threadId } : {}),
            ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
            ...(opts.journal !== undefined ? { journal: opts.journal } : {}),
            ...(opts.flow !== undefined ? { flow: opts.flow } : {}),
            ...(opts.tenantId !== undefined ? { tenantId: opts.tenantId } : {}),
            ...(opts.approvals !== undefined ? { approvals: opts.approvals } : {}),
            ...(opts.emit !== undefined ? { emit: opts.emit } : {}),
            ...(opts.runId !== undefined ? { runId: opts.runId } : {}),
            ...(opts.depth !== undefined ? { depth: opts.depth } : {}),
            ...(opts.maxCostPerRun !== undefined ? { maxCostPerRun: opts.maxCostPerRun } : {}),
            spent: cost,
            ...(opts.recordCall !== undefined ? { recordCall: opts.recordCall } : {}),
            spend,
          });
        } catch (err) {
          if (err instanceof AgentLoopHalt || isJournalSuspend(err)) throw err;
          if (err instanceof AiDurableRequiredError) throw err;
          if (err instanceof Error && err.name === "AgentDenied") {
            throw new AgentLoopHalt("denied", err, {
              trail,
              denials: runDenials,
              steps,
              cost,
              output: lastToolResult !== undefined ? lastToolResult : lastRaw,
            });
          }
          if (err instanceof Error && err.name === "AbortError") {
            throw new AgentLoopHalt("aborted", err, {
              trail,
              denials: runDenials,
              steps,
              cost,
              output: lastToolResult !== undefined ? lastToolResult : lastRaw,
            });
          }
          throw new AgentLoopHalt("error", err, {
            trail,
            denials: runDenials,
            steps,
            cost,
            output: lastToolResult !== undefined ? lastToolResult : lastRaw,
          });
        }
        lastToolResult = toolResult;
        cost += spend.cost;
        addUsageTokens(tokens, spend);
        opts.emit?.({
          type: "TOOL_CALL_RESULT",
          messageId: `m-${++messageSeq}`,
          toolCallId: callId,
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult ?? null),
          role: "tool",
        });
        messages.push({
          role: "tool",
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult ?? null),
          toolCallId: callId,
          name: tc.name,
        });
        if (capHit()) {
          budgetExceeded = true;
          stopReason = "budget";
          opts.emit?.({ type: "STEP_FINISHED", stepName });
          return finish();
        }
      }
      opts.emit?.({ type: "STEP_FINISHED", stepName });
    }

    return finish();
  }

  const runtime: AiRuntime = {
    prompts,
    agents,
    embeds,
    autoCacheDisabled: true,
    journalingForced,
    denials,
    agentRuns,
    journal,
    get lastExternal() {
      return egress.lastExternal;
    },
    set lastExternal(value) {
      egress.lastExternal = value;
    },
    async ask(prompt, input, opts) {
      const pin = parsePromptRef(prompt);
      const decl = prompts.get(pin.name) ?? prompts.get(prompt);
      if (!decl) throw new Error(`ai: unknown prompt "${prompt}"`);
      if (pin.version !== undefined && decl.version !== undefined && pin.version !== decl.version) {
        throw new Error(`ai: unknown prompt "${prompt}"`);
      }
      const version = decl.version;
      const started = now();
      const tools = opts?.tools ?? [];
      const signal = mergeAskAbortSignal(
        resolveTimeoutMs(opts?.timeout ?? decl.timeout),
        currentAbortSignal(),
      );

      const via =
        opts?.via ?? decl.via ?? (decl.model ? [decl.model] : [...models.keys()].slice(0, 1));
      const attempts: AiFallbackAttempt[] = [];
      let lastError: string | undefined;
      let lastSchema: AiSchemaMismatch | undefined;
      let totalCost = 0;
      const totalTokens: { inputTokens?: number; outputTokens?: number } = {};
      const userContent = askUserContent(input, decl.out);
      const responseFormat = promptResponseFormat(prompt, decl.out);

      const pushJournal = (entry: Omit<AiJournalEntry, "inputTokens" | "outputTokens">): void => {
        pushObservability(journal, {
          ...entry,
          ...tokenFields(totalTokens),
        });
      };

      const assertAskBudget = (spent: number): void => {
        const cap = decl.budget?.maxCostPerCall;
        if (cap === undefined || spent <= cap) return;
        const message = `ai: prompt "${prompt}" exceeded maxCostPerCall ${cap}`;
        if (journalingForced) {
          pushJournal({
            prompt,
            ...(version !== undefined ? { version } : {}),
            input,
            output: { error: message },
            attempts: [...attempts],
            outcome: "budget_exceeded",
            cost: spent,
            latencyMs: Math.max(0, now() - started),
            at: now(),
          });
        }
        const err = new Error(message);
        err.name = "AiBudgetExceededError";
        throw err;
      };

      for (const modelName of via) {
        let sameModelTries = 0;
        let repaired = false;
        let advance = true;
        while (sameModelTries < 2 && advance) {
          sameModelTries++;
          const attemptStart = now();
          try {
            const client = await clientFor(modelName);
            let raw: unknown;
            let attemptCost = 0;
            const sent: AiMessage[] = [{ role: "user", content: userContent }];

            if (tools.length > 0) {
              const loop = await toolLoop({
                client,
                modelName,
                messages: [{ role: "user", content: userContent }],
                tools,
                maxSteps: opts?.maxSteps ?? AI_DEFAULT_MAX_STEPS,
                agentLabel: prompt,
                ...(responseFormat !== undefined ? { responseFormat } : {}),
                callTool: opts?.callTool,
                ...(signal !== undefined ? { signal } : {}),
              });
              raw =
                loop.lastToolResult !== undefined && !loop.text ? loop.lastToolResult : loop.raw;
              attemptCost = loop.cost;
              totalCost += attemptCost;
              addUsageTokens(totalTokens, loop);
              assertAskBudget(totalCost);
              if (loop.denials.length > 0 && loop.trail.every((t) => t.status === "denied")) {
                throw new Error(
                  `ai: all tool calls denied for prompt "${prompt}": ${loop.denials[0]?.reason}`,
                );
              }
            } else {
              const result = await client.complete({
                model: wireModel(modelName, client),
                messages: sent,
                ...(responseFormat !== undefined ? { responseFormat } : {}),
                ...(signal !== undefined ? { signal } : {}),
              });
              if (result.external !== undefined) {
                egress.lastExternal = result.external;
              }
              attemptCost = result.usage?.cost ?? 0;
              totalCost += attemptCost;
              addUsageTokens(totalTokens, result.usage);
              assertAskBudget(totalCost);
              // Prefer assistant text — `raw` is often the transport envelope
              // (OpenAI chat.completion object), which must not shadow the content.
              raw =
                typeof result.text === "string" && result.text.length > 0
                  ? result.text
                  : result.raw !== undefined
                    ? result.raw
                    : result.text;
            }

            const latencyMs = Math.max(0, now() - attemptStart);

            try {
              const coerced = coerceModelObject(raw);
              const prepared = outExpectsVia(decl.out) ? { ...coerced, via: modelName } : coerced;
              const validated = decl.out
                ? validatePromptOut(prompt, version, decl.out, prepared)
                : prepared;
              // Always report the winning logical model for recovery chains.
              const output = { ...validated, via: modelName };
              attempts.push({
                model: modelName,
                ok: true,
                cost: attemptCost,
                latencyMs,
                at: now(),
              });
              if (journalingForced) {
                pushJournal({
                  prompt,
                  ...(version !== undefined ? { version } : {}),
                  input,
                  output,
                  attempts: [...attempts],
                  outcome: "ok",
                  cost: totalCost,
                  latencyMs: Math.max(0, now() - started),
                  at: now(),
                });
              }
              return output;
            } catch (err) {
              if (err instanceof AiSchemaValidationError) {
                lastSchema = err.mismatch;
                attempts.push({
                  model: modelName,
                  ok: true,
                  cost: attemptCost,
                  latencyMs,
                  at: now(),
                });
                if (journalingForced) {
                  pushJournal({
                    prompt,
                    ...(version !== undefined ? { version } : {}),
                    input,
                    output: coerceModelObject(raw),
                    attempts: [...attempts],
                    outcome: "schema_invalid",
                    cost: totalCost,
                    latencyMs: Math.max(0, now() - started),
                    schemaMismatch: err.mismatch,
                    at: now(),
                  });
                }
                if (decl.repair === 1 && !repaired) {
                  repaired = true;
                  const follow = await client.complete({
                    model: wireModel(modelName, client),
                    messages: [
                      ...sent,
                      {
                        role: "user",
                        content: `Schema mismatch: ${err.message}. Reply with JSON only.`,
                      },
                    ],
                    ...(responseFormat !== undefined ? { responseFormat } : {}),
                    ...(signal !== undefined ? { signal } : {}),
                  });
                  const repairCost = follow.usage?.cost ?? 0;
                  totalCost += repairCost;
                  addUsageTokens(totalTokens, follow.usage);
                  attempts.push({
                    model: modelName,
                    ok: true,
                    cost: repairCost,
                    latencyMs: Math.max(0, now() - attemptStart),
                    at: now(),
                  });
                  assertAskBudget(totalCost);
                  let repairRaw: unknown =
                    typeof follow.text === "string" && follow.text.length > 0
                      ? follow.text
                      : follow.raw !== undefined
                        ? follow.raw
                        : follow.text;
                  try {
                    const coerced = coerceModelObject(repairRaw);
                    const prepared = outExpectsVia(decl.out)
                      ? { ...coerced, via: modelName }
                      : coerced;
                    const validated = validatePromptOut(prompt, version, decl.out, prepared);
                    const output = { ...validated, via: modelName };
                    if (journalingForced) {
                      pushJournal({
                        prompt,
                        ...(version !== undefined ? { version } : {}),
                        input,
                        output,
                        attempts: [...attempts],
                        outcome: "ok",
                        cost: totalCost,
                        latencyMs: Math.max(0, now() - started),
                        at: now(),
                      });
                    }
                    return output;
                  } catch (again) {
                    if (again instanceof AiSchemaValidationError && journalingForced) {
                      pushJournal({
                        prompt,
                        ...(version !== undefined ? { version } : {}),
                        input,
                        output: coerceModelObject(repairRaw),
                        attempts: [...attempts],
                        outcome: "schema_invalid",
                        cost: totalCost,
                        latencyMs: Math.max(0, now() - started),
                        schemaMismatch: again.mismatch,
                        at: now(),
                      });
                    }
                    throw again;
                  }
                }
                throw err;
              }
              throw err;
            }
          } catch (err) {
            if (err instanceof AiSchemaValidationError) throw err;
            if (err instanceof Error && err.name === "AiBudgetExceededError") throw err;
            lastError = err instanceof Error ? err.message : String(err);
            attempts.push({
              model: modelName,
              ok: false,
              error: lastError,
              cost: 0,
              latencyMs: Math.max(0, now() - attemptStart),
              at: now(),
            });

            if (!isRetryableAiError(err)) {
              if (journalingForced) {
                pushJournal({
                  prompt,
                  ...(version !== undefined ? { version } : {}),
                  input,
                  output: { error: lastError },
                  attempts,
                  outcome: "provider_error",
                  cost: totalCost,
                  latencyMs: Math.max(0, now() - started),
                  at: now(),
                });
              }
              throw err instanceof Error ? err : new Error(String(err));
            }

            if (sameModelTries < 2) {
              await new Promise((r) => setTimeout(r, AI_SAME_MODEL_RETRY_BACKOFF_MS));
              continue;
            }
            advance = true;
            break;
          }
        }
      }

      if (journalingForced) {
        pushJournal({
          prompt,
          ...(version !== undefined ? { version } : {}),
          input,
          output: { error: lastError },
          attempts,
          outcome: lastSchema ? "schema_invalid" : "provider_error",
          cost: totalCost,
          latencyMs: Math.max(0, now() - started),
          ...(lastSchema ? { schemaMismatch: lastSchema } : {}),
          at: now(),
        });
      }
      throw new Error(`ai: all models failed for prompt "${prompt}": ${lastError}`);
    },

    async runAgent(agent, runOpts) {
      const decl = agents.get(agent);
      if (!decl) throw new Error(`ai: unknown agent "${agent}"`);
      const maxSteps = decl.maxSteps ?? AI_DEFAULT_MAX_STEPS;
      const modelName = decl.model ?? [...models.keys()][0] ?? "mock";
      const client = await clientFor(modelName);
      const started = now();
      const runId = await allocateAgentRunId(agent, runOpts);
      const threadId = runOpts.threadId ?? okid();
      const logHeader = agentLogHeader(runId, threadId, agent, runOpts);
      const safeAppend = async (event: AgUiEvent): Promise<void> => {
        try {
          await eventLog.append(runId, event, now());
        } catch (err) {
          noteAppendFailure(runId, agent, agentMessageLabel(runOpts), err);
        }
      };
      if (runOpts.journal) {
        await eventLog.open(logHeader);
        await safeAppend({ type: "RUN_STARTED", threadId, runId });
      }

      const remember = (partial: {
        readonly ok: boolean;
        readonly stopReason: AgentStopReason;
        readonly steps: number;
        readonly trail: readonly AgentToolStep[];
        readonly denials: readonly AgentDenial[];
        readonly output: unknown;
        readonly cost: number;
        readonly error?: string;
      }) => {
        const record: AgentRunRecord = {
          id: runId,
          agent,
          message: agentMessageLabel(runOpts),
          ...(runOpts.parentRunId !== undefined ? { parentRunId: runOpts.parentRunId } : {}),
          ok: partial.ok,
          stopReason: partial.stopReason,
          ...(partial.error !== undefined ? { error: partial.error } : {}),
          steps: partial.steps,
          trail: partial.trail,
          denials: partial.denials,
          output: partial.output,
          at: started,
          finishedAt: now(),
          threadId,
          cost: partial.cost,
          ...(loopTokens.inputTokens !== undefined ? { inputTokens: loopTokens.inputTokens } : {}),
          ...(loopTokens.outputTokens !== undefined
            ? { outputTokens: loopTokens.outputTokens }
            : {}),
        };
        pushObservability(agentRuns, record);
        return {
          ok: record.ok,
          stopReason: record.stopReason,
          steps: record.steps,
          denials: record.denials,
          trail: record.trail,
          output: record.output,
          cost: record.cost,
          ...(loopTokens.inputTokens !== undefined ? { inputTokens: loopTokens.inputTokens } : {}),
          ...(loopTokens.outputTokens !== undefined
            ? { outputTokens: loopTokens.outputTokens }
            : {}),
        };
      };
      let loopTokens: { inputTokens?: number; outputTokens?: number } = {};
      let appendChain: Promise<unknown> = Promise.resolve();

      try {
        const loop = await toolLoop({
          client,
          modelName,
          messages: agentMessages(runOpts),
          tools: decl.tools,
          maxSteps,
          ...(runOpts.maxCostPerRun !== undefined
            ? { maxCostPerRun: runOpts.maxCostPerRun }
            : decl.budget?.maxCostPerRun !== undefined
              ? { maxCostPerRun: decl.budget.maxCostPerRun }
              : {}),
          agentLabel: agent,
          runId,
          depth: runOpts.depth ?? 1,
          ...(runOpts.recordCall !== undefined ? { recordCall: runOpts.recordCall } : {}),
          callTool: runOpts.callTool,
          auth: runOpts.auth,
          operator: runOpts.operator,
          meta: runOpts.meta,
          signal: currentAbortSignal(),
          threadId,
          ...(runOpts.journal !== undefined
            ? {
                emit: (event: AgUiEvent) => {
                  appendChain = appendChain.then(() => safeAppend(event));
                },
              }
            : {}),
          ...(runOpts.journal !== undefined ? { journal: runOpts.journal } : {}),
          ...(runOpts.flow !== undefined ? { flow: runOpts.flow } : {}),
          ...(runOpts.tenantId !== undefined ? { tenantId: runOpts.tenantId } : {}),
          ...(decl.approvals !== undefined ? { approvals: decl.approvals } : {}),
        });
        await appendChain;
        loopTokens = tokenFields(loop);
        const settled = remember({
          ok: loop.stopReason === "completed" && loop.denials.length === 0,
          stopReason: loop.stopReason,
          steps: loop.steps,
          trail: loop.trail,
          denials: loop.denials,
          output: loop.output,
          cost: loop.cost,
        });
        if (runOpts.journal) {
          await safeAppend({
            type: "RUN_FINISHED",
            threadId,
            runId,
            result: { cost: loop.cost, stopReason: loop.stopReason, output: loop.output },
            ...(loopTokens.inputTokens !== undefined || loopTokens.outputTokens !== undefined
              ? { usage: [tokenFields(loopTokens)] }
              : {}),
          });
        }
        return settled;
      } catch (err) {
        if (err instanceof AgentLoopHalt) {
          const result = remember({
            ok: false,
            stopReason: err.stopReason,
            steps: err.steps,
            trail: err.trail,
            denials: err.denials,
            output: err.output,
            cost: err.cost,
            ...(err.stopReason === "error"
              ? { error: err.cause instanceof Error ? err.cause.message : String(err.cause) }
              : {}),
          });
          if (err.stopReason === "aborted" || err.stopReason === "error") {
            if (runOpts.journal) {
              const cause = err.cause instanceof Error ? err.cause : undefined;
              await safeAppend({
                type: "RUN_ERROR",
                message: cause?.message ?? String(err.cause),
                ...(cause && cause.name !== "Error" ? { code: cause.name } : {}),
              });
            }
            throw err.cause;
          }
          if (runOpts.journal) {
            await safeAppend({
              type: "RUN_FINISHED",
              threadId,
              runId,
              result: {
                cost: err.cost,
                stopReason: err.stopReason,
                output: err.output,
              },
              ...(loopTokens.inputTokens !== undefined || loopTokens.outputTokens !== undefined
                ? { usage: [tokenFields(loopTokens)] }
                : {}),
            });
          }
          return result;
        }
        if (runOpts.journal) {
          const error = err instanceof Error ? err : undefined;
          await safeAppend({
            type: "RUN_ERROR",
            message: error?.message ?? String(err),
            ...(error && error.name !== "Error" ? { code: error.name } : {}),
          });
        }
        throw err;
      }
    },

    streamAsk(prompt, input, opts) {
      const queue = createEventQueue();
      const runId = `ask-${++runSeq}`;
      const signal = currentAbortSignal();
      void (async () => {
        try {
          queue.emit({ type: "RUN_STARTED", threadId: "default", runId });
          const tools = opts?.tools ?? [];
          if (tools.length > 0) {
            const pin = parsePromptRef(prompt);
            const decl = prompts.get(pin.name) ?? prompts.get(prompt);
            if (!decl) throw new Error(`ai: unknown prompt "${prompt}"`);
            const via =
              opts?.via ?? decl.via ?? (decl.model ? [decl.model] : [...models.keys()].slice(0, 1));
            const modelName = via[0];
            if (!modelName) throw new Error(`ai: no model for prompt "${prompt}"`);
            const client = await clientFor(modelName);
            const loop = await toolLoop({
              client,
              modelName,
              messages: [{ role: "user", content: askUserContent(input, decl.out) }],
              tools,
              maxSteps: opts?.maxSteps ?? AI_DEFAULT_MAX_STEPS,
              agentLabel: prompt,
              callTool: opts?.callTool,
              emit: queue.emit,
              signal,
            });
            queue.emit({
              type: "RUN_FINISHED",
              threadId: "default",
              runId,
              result: { cost: loop.cost, stopReason: loop.stopReason, output: loop.output },
              ...(tokenFields(loop).inputTokens !== undefined ||
              tokenFields(loop).outputTokens !== undefined
                ? { usage: [tokenFields(loop)] }
                : {}),
            });
          } else {
            const output = await runtime.ask(prompt, input, opts);
            emitAssistantText(queue.emit, "m-1", JSON.stringify(output));
            const spent = journal.at(-1)?.cost ?? 0;
            queue.emit({
              type: "RUN_FINISHED",
              threadId: "default",
              runId,
              result: { cost: spent, stopReason: "completed", output },
            });
          }
          queue.finish();
        } catch (err) {
          queue.emit({
            type: "RUN_ERROR",
            message: err instanceof Error ? err.message : String(err),
            ...(err instanceof Error && err.name !== "Error" ? { code: err.name } : {}),
          });
          queue.finish();
        }
      })();
      return queue.events;
    },

    streamAgent(agent, runOpts) {
      const queue = createEventQueue();
      const signal = currentAbortSignal();
      const threadId = runOpts.threadId ?? okid();
      let skipLoggedStart = false;
      let runId = runOpts.runId ?? "";
      let appendChain: Promise<unknown> = Promise.resolve();
      const emit: AgentEventEmit = (event) => {
        if (!runOpts.journal) {
          queue.emit(event);
          return;
        }
        if (skipLoggedStart && event.type === "RUN_STARTED") {
          queue.emit(event);
          return;
        }
        appendChain = appendChain.then(async () => {
          let seq: number | undefined;
          try {
            seq = await eventLog.append(runId, event, now());
          } catch (err) {
            noteAppendFailure(runId, agent, agentMessageLabel(runOpts), err);
          }
          queue.emit(seq !== undefined ? withSseId(event, String(seq)) : event);
        });
      };
      let resolveResult: (value: unknown) => void = () => undefined;
      let rejectResult: (err: unknown) => void = () => undefined;
      const result = new Promise<unknown>((resolve, reject) => {
        resolveResult = resolve;
        rejectResult = reject;
      });
      // HTTP drains the iterator and may never await `result`.
      void result.catch(() => undefined);
      void (async () => {
        let closed = false;
        const close = (err?: unknown): void => {
          if (closed) return;
          closed = true;
          queue.finish(err);
        };
        try {
          if (runOpts.journal) {
            runId = await allocateAgentRunId(agent, runOpts);
            await eventLog.open(agentLogHeader(runId, threadId, agent, runOpts));
            const prior = await eventLog.read(runId, 0);
            skipLoggedStart = prior.some((row) => row.event.type === "RUN_STARTED");
          } else {
            runId = runOpts.runId ?? okid();
          }
          emit({ type: "RUN_STARTED", threadId, runId });
          const decl = agents.get(agent);
          if (!decl) throw new Error(`ai: unknown agent "${agent}"`);
          const maxSteps = decl.maxSteps ?? AI_DEFAULT_MAX_STEPS;
          const modelName = decl.model ?? [...models.keys()][0] ?? "mock";
          const client = await clientFor(modelName);
          const started = now();
          const loop = await toolLoop({
            client,
            modelName,
            messages: agentMessages(runOpts),
            tools: decl.tools,
            maxSteps,
            ...(runOpts.maxCostPerRun !== undefined
              ? { maxCostPerRun: runOpts.maxCostPerRun }
              : decl.budget?.maxCostPerRun !== undefined
                ? { maxCostPerRun: decl.budget.maxCostPerRun }
                : {}),
            agentLabel: agent,
            runId,
            depth: runOpts.depth ?? 1,
            ...(runOpts.recordCall !== undefined ? { recordCall: runOpts.recordCall } : {}),
            callTool: runOpts.callTool,
            auth: runOpts.auth,
            operator: runOpts.operator,
            meta: runOpts.meta,
            emit,
            signal,
            threadId,
            ...(runOpts.journal !== undefined ? { journal: runOpts.journal } : {}),
            ...(runOpts.flow !== undefined ? { flow: runOpts.flow } : {}),
            ...(runOpts.tenantId !== undefined ? { tenantId: runOpts.tenantId } : {}),
            ...(decl.approvals !== undefined ? { approvals: decl.approvals } : {}),
          });
          const record: AgentRunRecord = {
            id: runId,
            agent,
            message: agentMessageLabel(runOpts),
            ...(runOpts.parentRunId !== undefined ? { parentRunId: runOpts.parentRunId } : {}),
            ok: loop.stopReason === "completed" && loop.denials.length === 0,
            stopReason: loop.stopReason,
            steps: loop.steps,
            trail: loop.trail,
            denials: loop.denials,
            output: loop.output,
            at: started,
            cost: loop.cost,
          };
          pushObservability(agentRuns, record);
          const usage = tokenFields(loop);
          const settled = {
            ok: record.ok,
            stopReason: record.stopReason,
            steps: record.steps,
            denials: record.denials,
            trail: record.trail,
            output: record.output,
            cost: record.cost,
            ...(usage.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
            ...(usage.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
          };
          resolveResult(settled);
          await appendChain;
          emit({
            type: "RUN_FINISHED",
            threadId,
            runId,
            result: { cost: loop.cost, stopReason: loop.stopReason, output: loop.output },
            ...(usage.inputTokens !== undefined || usage.outputTokens !== undefined
              ? { usage: [usage] }
              : {}),
          });
          await appendChain;
          close();
        } catch (err) {
          if (isJournalSuspend(err)) {
            await appendChain;
            rejectResult(err);
            close(err);
            return;
          }
          if (err instanceof AiDurableRequiredError) {
            emit({
              type: "RUN_ERROR",
              message: err.message,
              code: err.name,
            });
            await appendChain;
            rejectResult(err);
            close();
            return;
          }
          if (err instanceof AgentLoopHalt) {
            const message = err.cause instanceof Error ? err.cause.message : String(err.cause);
            pushObservability(agentRuns, {
              id: runId,
              agent,
              message: agentMessageLabel(runOpts),
              ok: false,
              stopReason: err.stopReason,
              ...(err.stopReason === "error" ? { error: message } : {}),
              steps: err.steps,
              trail: err.trail,
              denials: err.denials,
              output: err.output,
              at: now(),
              cost: err.cost,
            });
            if (err.stopReason === "error") {
              const settled = {
                ok: false,
                stopReason: err.stopReason,
                error: message,
                steps: err.steps,
                denials: err.denials,
                trail: err.trail,
                output: err.output,
                cost: err.cost,
              };
              resolveResult(settled);
              await appendChain;
              emit({
                type: "RUN_FINISHED",
                threadId,
                runId,
                result: {
                  cost: err.cost,
                  stopReason: "error",
                  output: err.output,
                  error: message,
                },
              });
              await appendChain;
              close();
              return;
            }
          }
          const message = err instanceof Error ? err.message : String(err);
          rejectResult(err);
          emit({
            type: "RUN_ERROR",
            message,
            ...(err instanceof Error && err.name !== "Error" ? { code: err.name } : {}),
          });
          await appendChain;
          close();
        } finally {
          try {
            await appendChain;
          } catch (err) {
            noteAppendFailure(runId, agent, agentMessageLabel(runOpts), err);
          }
          if (!closed) {
            queue.emit({ type: "RUN_ERROR", message: "agent run ended" });
            close();
          }
        }
      })();
      return Object.assign(queue.events, { result });
    },

    async *stream(model, streamOpts) {
      const via = [model, ...(streamOpts?.via ?? []).filter((name) => name !== model)];
      const content =
        streamOpts?.data !== undefined
          ? promptContentFromInput(streamOpts.data)
          : promptContentFromInput(streamOpts?.prompt ?? "");
      let lastError: unknown;
      for (const modelName of via) {
        let yielded = false;
        try {
          const client = await clientFor(modelName);
          if (!client.stream) {
            throw new Error(
              `ai: model "${modelName}" (driver ${client.driverId}) does not support stream`,
            );
          }
          for await (const chunk of client.stream({
            model: wireModel(modelName, client),
            messages: [{ role: "user", content }],
            signal: streamOpts?.signal,
          })) {
            if (chunk.text) {
              yielded = true;
              yield chunk.text;
            }
          }
          return;
        } catch (err) {
          lastError = err;
          if (yielded || !isRetryableAiError(err)) {
            throw err instanceof Error ? err : new Error(String(err));
          }
        }
      }
      throw lastError instanceof Error
        ? lastError
        : new Error(`ai: all models failed to stream: ${String(lastError)}`);
    },

    async callMcp(ref, input, signal) {
      return mcpClient.call(ref, input, signal ?? currentAbortSignal());
    },

    async embed(embedName, id, text) {
      const decl = embeds.get(embedName);
      if (!decl) throw new Error(`ai: unknown embed "${embedName}"`);
      if (!decl.into) throw new Error(`ai: embed "${embedName}" has no into`);
      const index = options.indexes?.[decl.into];
      if (!index) {
        throw new Error(`ai: index "${decl.into}" not registered`);
      }
      if (index.driverId === "meilisearch") {
        throw new Error(
          `ai: embed into "${decl.into}" needs a vector index (memory/pgvector) — ` +
            `"${index.driverId}" is full-text; embeddings don't apply`,
        );
      }
      const modelName = decl.model ?? [...models.keys()][0] ?? "mock";
      const vector = await this.embedVector(modelName, text);
      await index.upsert(id, vector, { text });
    },

    async resolveApproval(id, decision, ctx) {
      const store = options.journalStore;
      if (!store) return { ok: false, status: 404 };
      const pending = await readAgentApproval(store, id);
      if (!pending) return { ok: false, status: 404 };
      if ((decision.tenant ?? null) !== (pending.tenant ?? null)) {
        return { ok: false, status: 404 };
      }
      if (options.gates) {
        const allowed = await options.gates.allow([pending.gate], ctx);
        if (!allowed) return { ok: false, status: 403 };
      } else if (pending.gate !== "public") {
        return { ok: false, status: 403 };
      }
      return resolveAgentApproval(store, id, decision, now);
    },

    async embedVector(modelName, text) {
      const client = await clientFor(modelName);
      if (!client.embed) {
        throw new Error(`ai: model "${modelName}" does not support embed`);
      }
      const result = await client.embed({ input: text, model: modelName });
      if (result.external !== undefined) {
        egress.lastExternal = result.external;
      }
      const vector = result.vectors[0];
      if (!vector) throw new Error("ai: empty embedding");
      return vector;
    },
  };
  self = runtime;
  return runtime;
}

export { AiSchemaValidationError } from "./schema.ts";
export type { AiSchemaMismatch } from "./schema.ts";
