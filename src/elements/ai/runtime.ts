/**
 * AI runtime — prompts, agents (flow tools + gates), embeds, journaling.
 *
 * Nondeterministic ⇒ journaling forced, auto-cache disabled.
 * Schema-validation failures are their own class (console §9.10).
 * Agent denials are recorded on the denial ledger — not errors.
 */

import type { AiDriver, AiModelClient } from "../../drivers/ai-types.ts";
import type { IndexStore } from "../../drivers/types.ts";
import type { GatePolicyContext } from "../gate/declare.ts";
import type { GateRuntime } from "../gate/runtime.ts";
import type { AiAgentDecl, AiEmbedDecl, AiModelDecl, AiPromptDecl } from "./declare.ts";
import {
  AiSchemaValidationError,
  coerceModelObject,
  validatePromptOut,
  type AiSchemaMismatch,
} from "./schema.ts";

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
   * Invoke a flow by name (agent tools). Must honour the flow's gates.
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
   * The UI must not re-derive these — they come from the runtime ledger.
   *
   * @param flowName - Flow name
   */
  readonly effectsForFlow?: (flowName: string) => readonly AgentToolEffect[];
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
}

/** Agent run options. */
export interface AiAgentRunOptions {
  readonly message: string;
  readonly auth?: GatePolicyContext["auth"];
  readonly operator?: GatePolicyContext["operator"];
  readonly meta?: GatePolicyContext["meta"];
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
   * Ask a prompt with optional model fallback chain.
   *
   * @param prompt - Prompt name
   * @param input - Prompt input
   * @param opts - via / allowPii
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
   * Embed text into the configured index store.
   *
   * @param embed - Embed name
   * @param id - Document id
   * @param text - Text to embed
   */
  embed(embed: string, id: string, text: string): Promise<void>;
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

  function effectsFor(tool: string): readonly AgentToolEffect[] {
    return options.effectsForFlow?.(tool) ?? [];
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

      // Replay from journal when input matches (nondeterministic contract)
      if (journalingForced) {
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

      for (const modelName of via) {
        const attemptStart = now();
        try {
          const client = await clientFor(modelName);
          const result = await client.complete({
            model: modelName,
            messages: [
              {
                role: "user",
                content: typeof input === "string" ? input : JSON.stringify(input ?? {}),
              },
            ],
            responseFormat: decl.out,
          });
          const attemptCost = result.usage?.cost ?? 0;
          totalCost += attemptCost;
          const latencyMs = Math.max(0, now() - attemptStart);
          const raw = result.raw !== undefined ? result.raw : result.text;

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
      const maxSteps = decl.maxSteps ?? 6;
      const runDenials: AgentDenial[] = [];
      const trail: AgentToolStep[] = [];
      let steps = 0;
      let output: unknown = { message: runOpts.message };
      const started = now();

      // Simple tool loop: try each declared tool once (bounded).
      for (const tool of decl.tools) {
        if (steps >= maxSteps) break;
        steps++;
        const effects = effectsFor(tool);
        const requiredGates = options.gatesForFlow?.(tool) ?? [];
        if (requiredGates.length > 0 && options.gates) {
          const ctx: GatePolicyContext = {
            auth: runOpts.auth ?? {
              userId: null,
              scopes: new Set(),
            },
            operator: runOpts.operator ?? { id: null },
            meta: runOpts.meta,
          };
          const evaluations = await options.gates.check(requiredGates, ctx);
          const denied = evaluations.find((e) => !e.allowed);
          if (denied) {
            const denial: AgentDenial = {
              agent,
              tool,
              gate: denied.name,
              reason: denied.reason ?? "gate denied",
              at: now(),
            };
            runDenials.push(denial);
            denials.push(denial);
            trail.push({
              tool,
              status: "denied",
              effects,
              denial,
              at: denial.at,
            });
            continue;
          }
        }
        if (!options.callFlow) {
          const denial: AgentDenial = {
            agent,
            tool,
            gate: "(no-callFlow)",
            reason: "callFlow not configured",
            at: now(),
          };
          runDenials.push(denial);
          denials.push(denial);
          trail.push({
            tool,
            status: "denied",
            effects,
            denial,
            at: denial.at,
          });
          continue;
        }
        output = await options.callFlow(tool, {
          message: runOpts.message,
        });
        trail.push({
          tool,
          status: "ok",
          effects,
          at: now(),
        });
      }

      const record: AgentRunRecord = {
        id: `agent-run-${++runSeq}`,
        agent,
        message: runOpts.message,
        ok: runDenials.length === 0,
        steps,
        trail,
        denials: runDenials,
        output,
        at: started,
        cost: 0,
      };
      agentRuns.push(record);

      return {
        ok: record.ok,
        steps,
        denials: runDenials,
        trail,
        output,
        cost: record.cost,
      };
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
          `ai: embed into "${decl.into}" needs a vector index (memory/pgvector/libsql) — ` +
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
