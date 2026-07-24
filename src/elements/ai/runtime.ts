/**
 * AI runtime — prompts, agents (flow tools + gates), embeds, journaling.
 *
 * Nondeterministic ⇒ journaling forced, auto-cache disabled.
 */

import type {
  AiDriver,
  AiModelClient,
} from "../../drivers/ai-types.ts";
import type { IndexStore } from "../../drivers/types.ts";
import type { GatePolicyContext } from "../gate/declare.ts";
import type { GateRuntime } from "../gate/runtime.ts";
import type {
  AiAgentDecl,
  AiEmbedDecl,
  AiModelDecl,
  AiPromptDecl,
} from "./declare.ts";

/** Recorded agent tool denial. */
export interface AgentDenial {
  readonly agent: string;
  readonly tool: string;
  readonly gate: string;
  readonly reason: string;
  readonly at: number;
}

/** Fallback attempt for model routing (`via` chains). */
export interface AiFallbackAttempt {
  readonly model: string;
  readonly ok: boolean;
  readonly error?: string;
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
  readonly callFlow?: (
    name: string,
    input: unknown,
  ) => Promise<unknown>;
  /**
   * Resolve gates required for a tool flow.
   *
   * @param flowName - Flow name
   */
  readonly gatesForFlow?: (flowName: string) => readonly string[];
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

/** Journal entry for a nondeterministic ask. */
export interface AiJournalEntry {
  readonly prompt: string;
  readonly input: unknown;
  readonly output: unknown;
  readonly attempts: readonly AiFallbackAttempt[];
  readonly at: number;
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
  /** Agent denials recorded this process. */
  readonly denials: readonly AgentDenial[];
  /** Journal of ask results (replay without re-calling the model). */
  readonly journal: readonly AiJournalEntry[];
  /**
   * Ask a prompt with optional model fallback chain.
   *
   * @param prompt - Prompt name
   * @param input - Prompt input
   * @param opts - via / allowPii
   */
  ask(
    prompt: string,
    input?: unknown,
    opts?: AiAskOptions,
  ): Promise<Record<string, unknown>>;
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
    readonly output?: unknown;
  }>;
  /**
   * Embed text into the configured index store.
   *
   * @param embed - Embed name
   * @param id - Document id
   * @param text - Text to embed
   */
  embed(
    embed: string,
    id: string,
    text: string,
  ): Promise<void>;
}

/**
 * Create an AI runtime.
 *
 * @param options - Declarations + clients + gates
 */
export function createAiRuntime(
  options: CreateAiRuntimeOptions = {},
): AiRuntime {
  const prompts = new Map<string, AiPromptDecl>();
  for (const p of options.prompts ?? []) prompts.set(p.name, p);
  const agents = new Map<string, AiAgentDecl>();
  for (const a of options.agents ?? []) agents.set(a.name, a);
  const embeds = new Map<string, AiEmbedDecl>();
  for (const e of options.embeds ?? []) embeds.set(e.name, e);
  const models = new Map<string, AiModelDecl>();
  for (const m of options.models ?? []) models.set(m.name, m);

  const clients = new Map<string, AiModelClient>(
    Object.entries(options.clients ?? {}),
  );
  const denials: AgentDenial[] = [];
  const journal: AiJournalEntry[] = [];
  const now = options.now ?? (() => Date.now());
  const journalingForced = options.forceJournal !== false;

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

  function validateOut(
    _decl: AiPromptDecl,
    value: unknown,
  ): Record<string, unknown> {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value) as unknown;
        if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>;
        }
      } catch {
        return { text: value };
      }
      return { text: value };
    }
    return { value };
  }

  return {
    prompts,
    agents,
    embeds,
    autoCacheDisabled: true,
    journalingForced,
    denials,
    journal,
    async ask(prompt, input, opts) {
      const decl = prompts.get(prompt);
      if (!decl) throw new Error(`ai: unknown prompt "${prompt}"`);

      // Replay from journal when input matches (nondeterministic contract)
      if (journalingForced) {
        const hit = [...journal]
          .reverse()
          .find(
            (e) =>
              e.prompt === prompt &&
              JSON.stringify(e.input) === JSON.stringify(input),
          );
        if (hit) {
          return hit.output as Record<string, unknown>;
        }
      }

      const via =
        opts?.via ??
        (decl.model ? [decl.model] : [...models.keys()].slice(0, 1));
      const attempts: AiFallbackAttempt[] = [];
      let lastError: string | undefined;

      for (const modelName of via) {
        try {
          const client = await clientFor(modelName);
          const result = await client.complete({
            model: modelName,
            messages: [
              {
                role: "user",
                content:
                  typeof input === "string" ? input : JSON.stringify(input ?? {}),
              },
            ],
            responseFormat: decl.out,
          });
          const output = validateOut(
            decl,
            result.raw !== undefined ? result.raw : result.text,
          );
          attempts.push({ model: modelName, ok: true, at: now() });
          if (journalingForced) {
            journal.push({
              prompt,
              input,
              output,
              attempts: [...attempts],
              at: now(),
            });
          }
          return output;
        } catch (err) {
          lastError = err instanceof Error ? err.message : String(err);
          attempts.push({
            model: modelName,
            ok: false,
            error: lastError,
            at: now(),
          });
        }
      }

      if (journalingForced) {
        journal.push({
          prompt,
          input,
          output: { error: lastError },
          attempts,
          at: now(),
        });
      }
      throw new Error(
        `ai: all models failed for prompt "${prompt}": ${lastError}`,
      );
    },

    async runAgent(agent, runOpts) {
      const decl = agents.get(agent);
      if (!decl) throw new Error(`ai: unknown agent "${agent}"`);
      const maxSteps = decl.maxSteps ?? 6;
      const runDenials: AgentDenial[] = [];
      let steps = 0;
      let output: unknown = { message: runOpts.message };

      // Simple tool loop: try each declared tool once (bounded).
      for (const tool of decl.tools) {
        if (steps >= maxSteps) break;
        steps++;
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
          continue;
        }
        output = await options.callFlow(tool, {
          message: runOpts.message,
        });
      }

      return {
        ok: runDenials.length === 0,
        steps,
        denials: runDenials,
        output,
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
