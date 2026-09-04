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
}

/** Full agent run recorded on the denial / trail ledger. */
export interface AgentRunRecord {
  readonly id: string;
  readonly agent: string;
  readonly message: string;
  readonly ok: boolean;
  readonly steps: number;
  readonly trail: readonly AgentToolStep[];
  readonly denials: readonly AgentDenial[];
  readonly output?: unknown;
  readonly at: number;
  readonly cost: number;
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
}

/** Agent run options. */
export interface AiAgentRunOptions {
  readonly message: string;
  readonly auth?: GatePolicyContext["auth"];
  readonly operator?: GatePolicyContext["operator"];
  readonly meta?: GatePolicyContext["meta"];
  /** Host-flow dispatch — must be `fx.call` when wired from fx.run. */
  readonly callTool?: (name: string, input: unknown) => Promise<unknown>;
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
  /** Journal of ask results (replay without re-calling the model). */
  readonly journal: readonly AiJournalEntry[];
  /**
   * Ask a prompt with optional model fallback chain and optional tools.
   *
   * @param prompt - Prompt name
   * @param input - Prompt input
   * @param opts - via / tools / callTool / allowPii
   */
  ask(prompt: string, input?: unknown, opts?: AiAskOptions): Promise<Record<string, unknown>>;
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
    readonly steps: number;
    readonly denials: readonly AgentDenial[];
    readonly trail: readonly AgentToolStep[];
    readonly output?: unknown;
    readonly cost: number;
  }>;
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
 * User message plus a JSON-only contract when `out` is declared.
 *
 * @param input - Ask input
 * @param out - Prompt output schema
 */
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
  const mcpClient: McpClient = createMcpClient({
    servers: options.mcpServers,
    ...(options.resolveSecret !== undefined ? { resolveSecret: options.resolveSecret } : {}),
    ...(options.mcpTransports !== undefined ? { transports: options.mcpTransports } : {}),
  });
  const denials: AgentDenial[] = [];
  const agentRuns: AgentRunRecord[] = [];
  const journal: AiJournalEntry[] = [];
  const now = options.now ?? (() => Date.now());
  const journalingForced = options.forceJournal !== false;
  let runSeq = 0;

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
    const opened = await driver.open({
      model: model?.model ?? name,
      ...(model?.baseUrl !== undefined ? { baseUrl: model.baseUrl } : {}),
      ...(model?.apiKey !== undefined ? { apiKey: model.apiKey } : {}),
    });
    clients.set(name, opened);
    return opened;
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
      throw new Error(`ai: model requested unknown tool "${tool}"`);
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
    readonly agentLabel: string;
    readonly responseFormat?: unknown;
    readonly signal?: AbortSignal;
    readonly callTool?: (name: string, input: unknown) => Promise<unknown>;
    readonly auth?: GatePolicyContext["auth"];
    readonly operator?: GatePolicyContext["operator"];
    readonly meta?: GatePolicyContext["meta"];
  }): Promise<{
    readonly output: unknown;
    readonly text: string;
    readonly raw: unknown;
    readonly lastToolResult: unknown;
    readonly trail: AgentToolStep[];
    readonly denials: AgentDenial[];
    readonly steps: number;
    readonly cost: number;
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
    const tokens: { inputTokens?: number; outputTokens?: number } = {};
    let lastText = "";
    let lastRaw: unknown = {};
    let lastToolResult: unknown;

    const providerModel = wireModel(opts.modelName, opts.client);
    while (steps < opts.maxSteps) {
      const result = await opts.client.complete({
        model: providerModel,
        messages,
        tools: defs.length > 0 ? defs : undefined,
        responseFormat: opts.responseFormat,
        ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
      });
      cost += result.usage?.cost ?? 0;
      addUsageTokens(tokens, result.usage);
      lastText = result.text;
      lastRaw = result.raw !== undefined ? result.raw : result.text;

      const toolCalls = result.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        return {
          output: lastToolResult !== undefined ? lastToolResult : lastRaw,
          text: lastText,
          raw: lastRaw,
          lastToolResult,
          trail,
          denials: runDenials,
          steps,
          cost,
          ...tokenFields(tokens),
        };
      }

      messages.push({
        role: "assistant",
        content: result.text || "",
        toolCalls,
      });

      for (const tc of toolCalls) {
        if (steps >= opts.maxSteps) break;
        steps++;
        const toolResult = await dispatchTool({
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
          ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
        });
        lastToolResult = toolResult;
        messages.push({
          role: "tool",
          content: typeof toolResult === "string" ? toolResult : JSON.stringify(toolResult ?? null),
          toolCallId: tc.id,
          name: tc.name,
        });
      }
    }

    return {
      output: lastToolResult !== undefined ? lastToolResult : lastRaw,
      text: lastText,
      raw: lastRaw,
      lastToolResult,
      trail,
      denials: runDenials,
      steps,
      cost,
      ...tokenFields(tokens),
    };
  }

  return {
    prompts,
    agents,
    embeds,
    autoCacheDisabled: true,
    journalingForced,
    denials,
    agentRuns,
    journal,
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

      // Replay from journal when input matches (nondeterministic contract)
      if (journalingForced && tools.length === 0) {
        const hit = [...journal]
          .reverse()
          .find(
            (e) =>
              e.prompt === prompt &&
              e.outcome === "ok" &&
              JSON.stringify(e.input) === JSON.stringify(input),
          );
        if (hit) {
          return hit.output as Record<string, unknown>;
        }
      }

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
        journal.push({
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
        let advance = true;
        while (sameModelTries < 2 && advance) {
          sameModelTries++;
          const attemptStart = now();
          try {
            const client = await clientFor(modelName);
            let raw: unknown;
            let attemptCost = 0;

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
                messages: [{ role: "user", content: userContent }],
                ...(responseFormat !== undefined ? { responseFormat } : {}),
                ...(signal !== undefined ? { signal } : {}),
              });
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
                throw err;
              }
              throw err;
            }
          } catch (err) {
            if (err instanceof AiSchemaValidationError) throw err;
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

      const loop = await toolLoop({
        client,
        modelName,
        messages: [{ role: "user", content: promptContentFromInput(runOpts.message) }],
        tools: decl.tools,
        maxSteps,
        agentLabel: agent,
        callTool: runOpts.callTool,
        auth: runOpts.auth,
        operator: runOpts.operator,
        meta: runOpts.meta,
        signal: currentAbortSignal(),
      });
      const runCap = decl.budget?.maxCostPerRun;
      if (runCap !== undefined && loop.cost > runCap) {
        const err = new Error(`ai: agent "${agent}" exceeded maxCostPerRun ${runCap}`);
        err.name = "AiBudgetExceededError";
        throw err;
      }

      const record: AgentRunRecord = {
        id: `agent-run-${++runSeq}`,
        agent,
        message: runOpts.message,
        ok: loop.denials.length === 0,
        steps: loop.steps,
        trail: loop.trail,
        denials: loop.denials,
        output: loop.output,
        at: started,
        cost: loop.cost,
      };
      agentRuns.push(record);

      return {
        ok: record.ok,
        steps: loop.steps,
        denials: loop.denials,
        trail: loop.trail,
        output: loop.output,
        cost: record.cost,
      };
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

    async embedVector(modelName, text) {
      const client = await clientFor(modelName);
      if (!client.embed) {
        throw new Error(`ai: model "${modelName}" does not support embed`);
      }
      const { vectors } = await client.embed({ input: text, model: modelName });
      const vector = vectors[0];
      if (!vector) throw new Error("ai: empty embedding");
      return vector;
    },
  };
}

export { AiSchemaValidationError } from "./schema.ts";
export type { AiSchemaMismatch } from "./schema.ts";
