/**
 * AI runtime — prompts, agents (flow tools + gates), embeds, journaling.
 *
 * Nondeterministic ⇒ journaling forced, auto-cache disabled.
 * Schema-validation failures are their own class (console §9.10).
 * Agent denials are recorded on the denial ledger — not errors.
 * Tool invocations go through a caller-supplied `callTool` (host `fx.call`).
 */

import type { AiDriver, AiMessage, AiModelClient, AiToolDef } from "../../drivers/ai-types.ts";
import type { IndexStore } from "../../drivers/types.ts";
import { maskRedactedDeep } from "../../kernel/redacted.ts";
import type { GatePolicyContext } from "../gate/declare.ts";
import type { GateRuntime } from "../gate/runtime.ts";
import type { AiAgentDecl, AiEmbedDecl, AiModelDecl, AiPromptDecl } from "./declare.ts";
import {
  AiSchemaValidationError,
  coerceModelObject,
  validatePromptOut,
  type AiSchemaMismatch,
} from "./schema.ts";

/** Default bound for tool / agent loops. */
export const AI_DEFAULT_MAX_STEPS = 6;

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
  readonly kind: "read" | "write" | "emit" | "send" | "ask" | "secret" | "call";
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
export type AiAskOutcome = "ok" | "provider_error" | "schema_invalid";

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
  readonly schemaMismatch?: AiSchemaMismatch;
  readonly at: number;
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
}

/** Ask options. */
export interface AiAskOptions {
  readonly via?: readonly string[];
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
   * Embed text into the configured index store.
   *
   * @param embed - Embed name
   * @param id - Document id
   * @param text - Text to embed
   */
  embed(embed: string, id: string, text: string): Promise<void>;
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
  const denials: AgentDenial[] = [];
  const agentRuns: AgentRunRecord[] = [];
  const journal: AiJournalEntry[] = [];
  const now = options.now ?? (() => Date.now());
  const journalingForced = options.forceJournal !== false;
  let runSeq = 0;

  async function clientFor(name: string): Promise<AiModelClient> {
    const existing = clients.get(name);
    if (existing) return existing;
    if (!options.defaultDriver) {
      throw new Error(`ai: no client for model "${name}" and no defaultDriver`);
    }
    const model = models.get(name);
    const opened = await options.defaultDriver.open({
      model: model?.model ?? name,
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

  function toolDefsFor(toolNames: readonly string[]): AiToolDef[] {
    return toolNames.map((name) => ({
      name,
      description: `Flow tool: ${name}`,
      parameters: options.toolSchemaForFlow?.(name) ?? { type: "object", properties: {} },
    }));
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
    } = opts;
    const effects = effectsFor(tool);

    if (!allowedTools.has(tool)) {
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

    const requiredGates = options.gatesForFlow?.(tool) ?? [];
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

    const output = await invoke(tool, args);
    trail.push({ tool, status: "ok", effects, at: now() });
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
  }> {
    const messages = [...opts.messages];
    const defs = toolDefsFor(opts.tools);
    const allowed = new Set(opts.tools);
    const trail: AgentToolStep[] = [];
    const runDenials: AgentDenial[] = [];
    let steps = 0;
    let cost = 0;
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
      });
      cost += result.usage?.cost ?? 0;
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
      const decl = prompts.get(prompt);
      if (!decl) throw new Error(`ai: unknown prompt "${prompt}"`);
      const version = decl.version;
      const started = now();
      const tools = opts?.tools ?? [];

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

      const via = opts?.via ?? (decl.model ? [decl.model] : [...models.keys()].slice(0, 1));
      const attempts: AiFallbackAttempt[] = [];
      let lastError: string | undefined;
      let lastSchema: AiSchemaMismatch | undefined;
      let totalCost = 0;
      const userContent = promptContentFromInput(input);

      for (const modelName of via) {
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
              responseFormat: decl.out,
              callTool: opts?.callTool,
            });
            raw = loop.lastToolResult !== undefined && !loop.text ? loop.lastToolResult : loop.raw;
            attemptCost = loop.cost;
            totalCost += attemptCost;
            if (loop.denials.length > 0 && loop.trail.every((t) => t.status === "denied")) {
              throw new Error(
                `ai: all tool calls denied for prompt "${prompt}": ${loop.denials[0]?.reason}`,
              );
            }
          } else {
            const result = await client.complete({
              model: wireModel(modelName, client),
              messages: [{ role: "user", content: userContent }],
              responseFormat: decl.out,
            });
            attemptCost = result.usage?.cost ?? 0;
            totalCost += attemptCost;
            raw = result.raw !== undefined ? result.raw : result.text;
          }

          const latencyMs = Math.max(0, now() - attemptStart);

          try {
            const output = decl.out
              ? validatePromptOut(prompt, version, decl.out, raw)
              : coerceModelObject(raw);
            attempts.push({
              model: modelName,
              ok: true,
              cost: attemptCost,
              latencyMs,
              at: now(),
            });
            if (journalingForced) {
              journal.push({
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
                journal.push({
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
        }
      }

      if (journalingForced) {
        journal.push({
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
      });

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
      const client = await clientFor(model);
      if (!client.stream) {
        throw new Error(`ai: model "${model}" (driver ${client.driverId}) does not support stream`);
      }
      const content =
        streamOpts?.data !== undefined
          ? promptContentFromInput(streamOpts.data)
          : promptContentFromInput(streamOpts?.prompt ?? "");
      for await (const chunk of client.stream({
        model: wireModel(model, client),
        messages: [{ role: "user", content }],
        signal: streamOpts?.signal,
      })) {
        if (chunk.text) yield chunk.text;
      }
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
      const client = await clientFor(modelName);
      if (!client.embed) {
        throw new Error(`ai: model "${modelName}" does not support embed`);
      }
      const { vectors } = await client.embed({ input: text, model: modelName });
      const vector = vectors[0];
      if (!vector) throw new Error("ai: empty embedding");
      await index.upsert(id, vector, { text });
    },
  };
}

export { AiSchemaValidationError } from "./schema.ts";
export type { AiSchemaMismatch } from "./schema.ts";
