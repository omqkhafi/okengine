/**
 * AI declaration — models, versioned prompts, embeds, agents.
 *
 * Physics: inference · prompts · embeddings · agents.
 */

import {
  aiAgentRegistry,
  aiEmbedRegistry,
  aiModelRegistry,
  aiPromptRegistry,
} from "../../kernel/element-registries.ts";

/** Budget for a prompt or agent. */
export interface AiBudgetDecl {
  readonly maxCostPerCall?: number;
  readonly maxCostPerRun?: number;
}

/** Options for {@link ai.model}. */
export interface AiModelOptions {
  readonly provider?: string;
  readonly tier?: string;
  readonly model?: string;
  /**
   * Optional endpoint override for this logical binding (openai-compatible /
   * ollama). Lets `fx.ask(…, { via: ["smart", "local"] })` reach cloud then
   * local without sharing one process-wide base URL.
   */
  readonly baseUrl?: string;
  /** Optional API key override for this binding (cloud providers). */
  readonly apiKey?: string;
}

/**
 * Ask deadline — clock duration string (`"30s"`, `"2m"`) or milliseconds.
 * Time is not a cost budget; keep it off {@link AiBudgetDecl}.
 */
export type AiTimeout = string | number;

/** Options for {@link AiModelDecl.prompt}. */
export interface AiPromptOptions {
  readonly version?: number;
  readonly evals?: string;
  readonly budget?: AiBudgetDecl;
  /**
   * Ordered recovery chain of logical model names for this command.
   * Resolved as `ask.via ?? prompt.via ?? [prompt.model]`.
   */
  readonly via?: readonly string[];
  /** Per-command deadline (overrides only when ask omits `timeout`). */
  readonly timeout?: AiTimeout;
  readonly in?: unknown;
  readonly out?: unknown;
}

/** Options for {@link ai.embed}. */
export interface AiEmbedOptions {
  readonly model?: AiModelDecl | string;
  readonly into?: { readonly name: string; readonly facet?: string } | string;
}

/** Options for {@link ai.agent}. */
export interface AiAgentOptions {
  readonly model?: AiModelDecl | string;
  readonly tools?: readonly ({ readonly name: string } | string)[];
  readonly maxSteps?: number;
  readonly budget?: AiBudgetDecl;
}

/** Declared model handle — can mint prompts. */
export interface AiModelDecl {
  readonly kind: "model";
  readonly name: string;
  readonly provider?: string;
  readonly tier?: string;
  readonly model?: string;
  readonly baseUrl?: string;
  readonly apiKey?: string;
  /**
   * Declare a versioned prompt artifact on this model.
   *
   * @param name - Prompt id
   * @param options - Version / evals / schemas / budget
   */
  prompt(name: string, options?: AiPromptOptions): AiPromptDecl;
}

/** Declared versioned prompt. */
export interface AiPromptDecl {
  readonly kind: "prompt";
  readonly name: string;
  readonly version?: number;
  readonly evals?: string;
  readonly budget?: AiBudgetDecl;
  readonly via?: readonly string[];
  readonly timeout?: AiTimeout;
  readonly model?: string;
  readonly in?: unknown;
  readonly out?: unknown;
}

/** Declared embedding pipeline into `store.index`. */
export interface AiEmbedDecl {
  readonly kind: "embed";
  readonly name: string;
  readonly model?: string;
  readonly into?: string;
}

/** Declared agent whose tools are flows. */
export interface AiAgentDecl {
  readonly kind: "agent";
  readonly name: string;
  readonly tools: readonly string[];
  readonly maxSteps?: number;
  readonly model?: string;
  readonly budget?: AiBudgetDecl;
}

/**
 * Resolve a tool ref to a flow name.
 *
 * @param tool - Flow handle or string
 */
function toolName(tool: { readonly name: string } | string): string {
  return typeof tool === "string" ? tool : tool.name;
}

/**
 * Shape of the {@link ai} element namespace.
 */
export interface AiNamespace {
  /**
   * Declare a model binding.
   *
   * @param name - Logical model name (`smart`, `fast`, …)
   * @param options - Provider / tier / model id
   */
  model(name: string, options?: AiModelOptions): AiModelDecl;
  /**
   * Declare an embedding pipeline into a store.index.
   *
   * @param name - Embed id
   * @param options - Model + destination index
   */
  embed(name: string, options?: AiEmbedOptions): AiEmbedDecl;
  /**
   * Declare a bounded agent whose tools are the app's own flows.
   *
   * @param name - Agent id
   * @param options - Tools / maxSteps / model / budget
   */
  agent(name: string, options?: AiAgentOptions): AiAgentDecl;
}

/**
 * Snapshot of AI decls registered since the last reset.
 */
export function listAiDecls(): {
  readonly models: readonly AiModelDecl[];
  readonly prompts: readonly AiPromptDecl[];
  readonly embeds: readonly AiEmbedDecl[];
  readonly agents: readonly AiAgentDecl[];
} {
  return {
    models: aiModelRegistry.slice(),
    prompts: aiPromptRegistry.slice(),
    embeds: aiEmbedRegistry.slice(),
    agents: aiAgentRegistry.slice(),
  };
}

/**
 * Clear AI declaration registries (tests / fresh app adopt).
 */
export function resetAiDecls(): void {
  aiModelRegistry.length = 0;
  aiPromptRegistry.length = 0;
  aiEmbedRegistry.length = 0;
  aiAgentRegistry.length = 0;
}

/**
 * AI element namespace.
 */
export const ai: AiNamespace = {
  /**
   * Declare a model binding.
   *
   * @param name - Logical model name (`smart`, `fast`, …)
   * @param options - Provider / tier / model id
   */
  model(name: string, options: AiModelOptions = {}): AiModelDecl {
    if (!name) throw new TypeError("ai.model: name is required");
    const decl: AiModelDecl = {
      kind: "model",
      name,
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.tier !== undefined ? { tier: options.tier } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      prompt(promptName, promptOpts = {}) {
        const promptDecl: AiPromptDecl = {
          kind: "prompt",
          name: promptName,
          model: name,
          ...(promptOpts.version !== undefined ? { version: promptOpts.version } : {}),
          ...(promptOpts.evals !== undefined ? { evals: promptOpts.evals } : {}),
          ...(promptOpts.budget !== undefined ? { budget: promptOpts.budget } : {}),
          ...(promptOpts.via !== undefined ? { via: promptOpts.via } : {}),
          ...(promptOpts.timeout !== undefined ? { timeout: promptOpts.timeout } : {}),
          ...(promptOpts.in !== undefined ? { in: promptOpts.in } : {}),
          ...(promptOpts.out !== undefined ? { out: promptOpts.out } : {}),
        };
        aiPromptRegistry.push(promptDecl);
        return promptDecl;
      },
    };
    aiModelRegistry.push(decl);
    return decl;
  },

  /**
   * Declare an embedding pipeline into a store.index.
   *
   * @param name - Embed id
   * @param options - Model + destination index
   */
  embed(name: string, options: AiEmbedOptions = {}): AiEmbedDecl {
    const model = typeof options.model === "string" ? options.model : options.model?.name;
    const into = typeof options.into === "string" ? options.into : options.into?.name;
    const decl: AiEmbedDecl = {
      kind: "embed",
      name,
      ...(model !== undefined ? { model } : {}),
      ...(into !== undefined ? { into } : {}),
    };
    aiEmbedRegistry.push(decl);
    return decl;
  },

  /**
   * Declare a bounded agent whose tools are the app's own flows.
   *
   * @param name - Agent id
   * @param options - Tools / maxSteps / model / budget
   */
  agent(name: string, options: AiAgentOptions = {}): AiAgentDecl {
    const decl: AiAgentDecl = {
      kind: "agent",
      name,
      tools: (options.tools ?? []).map(toolName),
      ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
      ...(options.budget !== undefined ? { budget: options.budget } : {}),
      ...(typeof options.model === "string"
        ? { model: options.model }
        : options.model?.name !== undefined
          ? { model: options.model.name }
          : {}),
    };
    aiAgentRegistry.push(decl);
    return decl;
  },
};
