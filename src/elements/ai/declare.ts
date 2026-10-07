/**
 * AI declaration — models, versioned prompts, embeds, agents.
 *
 * Physics: inference · prompts · embeddings · agents.
 */

import {
  aiAgentRegistry,
  aiDeciderRegistry,
  aiDecisionRegistry,
  aiEmbedRegistry,
  aiMcpServerRegistry,
  aiModelRegistry,
  aiPromptRegistry,
} from "../../kernel/element-registries.ts";
import {
  DECIDER_PRESETS,
  resolveDecider,
  type DeciderCapabilities,
  type DeciderProtocol,
  type DeciderPinning,
} from "./deciders/presets.ts";
import { mcpToolRef, type McpToolRef } from "../../manifest/mcp-ref.ts";
import type { VaultSecretDecl } from "../vault/declare.ts";
import { formatAiProviderTier2Warn, resolveAiModelBaseUrl } from "./providers.ts";

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
   * local). When omitted and `provider` is a known OpenAI-compatible name,
   * the verified registry base URL is filled in automatically. Explicit
   * `baseUrl` always wins (self-hosted proxy / mirror).
   */
  readonly baseUrl?: string;
  /** Optional API key override for this binding (cloud providers). */
  readonly apiKey?: string;
  /**
   * Protocol driver for this binding (`anthropic`, `openai-compatible`, …).
   * When omitted, the app-level default driver is used.
   */
  readonly driverId?: string;
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
  /** One schema-mismatch retry. Default `0` throws on the first mismatch. */
  readonly repair?: 0 | 1;
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

/** Who may have to approve one agent tool before it runs. */
export type AiToolApproval =
  | boolean
  | ((input: unknown, ctx: { readonly auth?: unknown; readonly tenant?: unknown }) => boolean);

/** One agent tool, optionally held for approval. */
export interface AiAgentToolOptions {
  readonly name: string;
  /** `true` always waits. A function waits only when it returns true. */
  readonly approval?: AiToolApproval;
  /** Gate that may approve or deny. Required when {@link approval} is set. */
  readonly gate?: { readonly name: string } | string;
  /** How long to wait before a deny. Default `24h`. */
  readonly timeout?: string;
}

/**
 * Choice answer a Flow can receive. Author keys, plus `none_of_these`.
 *
 * @typeParam Options - Author option map
 */
export type DecisionChoiceValue<Options extends Readonly<Record<string, string | null>>> =
  | keyof Options
  | "none_of_these";

/** One choice question. `none_of_these` is injected on the wire. */
export interface AiChoiceQuestion {
  readonly kind: "choice";
  readonly instructions: string;
  readonly options: Readonly<Record<string, string | null>>;
}

/** One ordered score question. */
export interface AiScoreQuestion {
  readonly kind: "score";
  readonly instructions: string;
  readonly levels: readonly string[];
}

/** One yes/no question. The wire type is `noul`. */
export interface AiBooleanQuestion {
  readonly kind: "boolean";
  readonly instructions: string;
  readonly criteria?: { readonly true?: string; readonly false?: string };
}

/** A question inside `ai.decision({ ask })`. */
export type AiDecisionQuestion = AiChoiceQuestion | AiScoreQuestion | AiBooleanQuestion;

/** Autonomy grant. Present only in the lockfile's certificate. */
export interface AiDecisionAutonomy {
  readonly maxError: number;
  /** Audit sample rate in `[0, 1]`. Required whenever autonomy is set. */
  readonly audit: number;
  /** Learn-then-Test family-wise level. Default `0.1`. */
  readonly risk?: number;
}

/** Questions a capability row allows. A `false` flag removes that kind. */
export type AskForCapabilities<C> = Readonly<
  Record<
    string,
    | (C extends { readonly boolean: true } ? AiBooleanQuestion : never)
    | (C extends { readonly choice: true } ? AiChoiceQuestion : never)
    | (C extends { readonly score: true } ? AiScoreQuestion : never)
  >
>;

/** Options for a preset host. URL, protocol, secret, and capabilities are filled in. */
export interface AiDeciderPresetOptions {
  readonly provider: "openrouter" | "openai";
  readonly model: string;
  readonly secret?: string;
  readonly region?: string;
  readonly zdr?: boolean;
  readonly timeout?: AiTimeout;
  readonly concurrency?: number;
}

/** Options for a host that is not a preset. */
export interface AiDeciderCustomOptions<C extends DeciderCapabilities = DeciderCapabilities> {
  readonly provider?: string;
  readonly driverId: DeciderProtocol;
  readonly baseUrl: string;
  readonly model: string;
  readonly secret: string;
  readonly capabilities: C;
  readonly region?: string;
  readonly zdr?: boolean;
  readonly timeout?: AiTimeout;
  readonly concurrency?: number;
}

/** Options for {@link ai.decider}. */
export type AiDeciderOptions<C extends DeciderCapabilities = DeciderCapabilities> =
  | AiDeciderPresetOptions
  | AiDeciderCustomOptions<C>;

/** Declared decider. One model, one breaker, one certificate. */
export interface AiDeciderDecl<C extends DeciderCapabilities = DeciderCapabilities> {
  readonly kind: "decider";
  readonly name: string;
  readonly provider?: string;
  readonly protocol: DeciderProtocol;
  readonly baseUrl: string;
  readonly model: string;
  readonly secret: string;
  readonly pinning: DeciderPinning;
  readonly capabilities: C;
  readonly region?: string;
  readonly regionStatus?: "declared";
  readonly zdr?: boolean;
  readonly zdrStatus?: "declared";
  readonly timeout?: AiTimeout;
  readonly concurrency?: number;
}

/** Options for {@link ai.decision}. `decider` and `otherwise` are required. */
export interface AiDecisionOptions<C extends DeciderCapabilities = DeciderCapabilities> {
  readonly decider: AiDeciderDecl<C>;
  readonly backup?: readonly AiDeciderDecl[];
  /** A gate name parks. `"abstain"` returns null and does not park. */
  readonly otherwise: { readonly name: string } | string;
  readonly in?: unknown;
  readonly ask: AskForCapabilities<C>;
  readonly autonomy?: AiDecisionAutonomy;
  readonly locale?: (input: unknown) => string | undefined;
  readonly evals?: string;
  /** Reserved. Using it fails with a message that says it is planned. */
  readonly shadow?: never;
}

/** Declared decision handle. */
export interface AiDecisionDecl {
  readonly kind: "decision";
  readonly name: string;
  readonly ask: Readonly<Record<string, AiDecisionQuestion>>;
  readonly mode: "review" | "abstain";
  /** Gate name when `otherwise` is a gate. */
  readonly review?: string;
  readonly decider: string;
  readonly backup: readonly string[];
  readonly otherwise: string;
  readonly secrets: readonly string[];
  readonly autonomy?: AiDecisionAutonomy;
  readonly evals?: string;
  readonly locale?: (input: unknown) => string | undefined;
  /** Declared `in` schema. Label export keeps only these fields. */
  readonly inputSchema?: unknown;
}

/** Options for {@link ai.agent}. */
export interface AiAgentOptions {
  readonly model?: AiModelDecl | string;
  readonly tools?: readonly (AiAgentToolOptions | { readonly name: string } | string)[];
  readonly maxSteps?: number;
  /** Nested agent depth. Default 3. */
  readonly maxDepth?: number;
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
  readonly driverId?: string;
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
  /** One schema-mismatch retry. Default `0`. */
  readonly repair?: 0 | 1;
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

/** Approval held on one tool. The predicate stays in code. */
export interface AiAgentApprovalDecl {
  readonly gate: string;
  readonly timeout: string;
  readonly when?: (
    input: unknown,
    ctx: { readonly auth?: unknown; readonly tenant?: unknown },
  ) => boolean;
}

/** Declared agent whose tools are flows. */
export interface AiAgentDecl {
  readonly kind: "agent";
  readonly name: string;
  readonly tools: readonly string[];
  readonly approvals?: Readonly<Record<string, AiAgentApprovalDecl>>;
  readonly maxSteps?: number;
  readonly maxDepth?: number;
  readonly model?: string;
  readonly budget?: AiBudgetDecl;
}

/** Bearer auth for {@link ai.mcpServer} — secret contract, never a token literal. */
export interface AiMcpServerAuthOptions {
  readonly bearer: VaultSecretDecl | string;
}

/** Options for {@link ai.mcpServer}. */
export interface AiMcpServerOptions {
  /** Streamable HTTP endpoint. */
  readonly url?: string;
  /** stdio executable (no shell string). */
  readonly command?: string;
  /** Arguments for {@link command}. */
  readonly args?: readonly string[];
  /** Bearer secret contract (`vault.secret` handle or name). */
  readonly auth?: AiMcpServerAuthOptions;
  /**
   * Required allowlist of tool names on this server.
   * The runtime never offers whatever `tools/list` happens to expose.
   */
  readonly tools: readonly string[];
}

/** Named capability ref returned by {@link AiMcpServerDecl.tool}. */
export interface AiMcpToolRef {
  readonly name: McpToolRef;
}

/**
 * Declared external MCP server — tools join `fx.call` / `toolLoop` as
 * `mcp:<server>/<tool>`.
 */
export interface AiMcpServerDecl {
  readonly kind: "mcp-server";
  readonly name: string;
  readonly url?: string;
  readonly command?: string;
  readonly args?: readonly string[];
  /** Secret contract name when bearer auth is declared. */
  readonly auth?: string;
  readonly tools: readonly string[];
  /**
   * Capability ref for one allowlisted tool (`mcp:<server>/<tool>`).
   *
   * @param tool - Tool name on this server
   */
  tool(tool: string): AiMcpToolRef;
}

/**
 * Resolve a tool ref to a flow name.
 *
 * @param tool - Flow handle or string
 */
function toolName(tool: { readonly name: string } | string): string {
  return typeof tool === "string" ? tool : tool.name;
}

function gateName(gate: { readonly name: string } | string): string {
  return typeof gate === "string" ? gate : gate.name;
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
  /**
   * Declare one model that can answer a decision.
   *
   * @param name - Decider id
   * @param options - Preset provider, or driverId + baseUrl + capabilities
   */
  decider(
    name: string,
    options: AiDeciderPresetOptions & { readonly provider: "openrouter" },
  ): AiDeciderDecl<(typeof DECIDER_PRESETS)["openrouter"]["capabilities"]>;
  decider(
    name: string,
    options: AiDeciderPresetOptions & { readonly provider: "openai" },
  ): AiDeciderDecl<(typeof DECIDER_PRESETS)["openai"]["capabilities"]>;
  decider<const C extends DeciderCapabilities>(
    name: string,
    options: AiDeciderCustomOptions<C>,
  ): AiDeciderDecl<C>;
  /**
   * Declare a decision. `decider` and `otherwise` are required.
   *
   * @param name - Decision id
   * @param options - Decider, fallback, and questions
   */
  decision<C extends DeciderCapabilities>(
    name: string,
    options: AiDecisionOptions<C>,
  ): AiDecisionDecl;
  /**
   * A choice question. The answer union includes author keys and `none_of_these`.
   *
   * @param instructions - What to decide
   * @param options - Author options. `none_of_these` is injected.
   */
  choice(instructions: string, options: Readonly<Record<string, string | null>>): AiChoiceQuestion;
  /**
   * An ordered score question.
   *
   * @param instructions - What to rate
   * @param levels - Level descriptions, low to high
   */
  score(instructions: string, levels: readonly string[]): AiScoreQuestion;
  /**
   * A yes/no question. Sent as `noul`.
   *
   * @param instructions - The yes/no question
   * @param criteria - Optional true/false descriptions
   */
  boolean(
    instructions: string,
    criteria?: { readonly true?: string; readonly false?: string },
  ): AiBooleanQuestion;
  /**
   * Declare an external MCP server whose allowlisted tools join `fx.call`.
   *
   * @param name - Server id (`github`, `linear`, …)
   * @param options - Transport + required tool allowlist
   */
  mcpServer(name: string, options: AiMcpServerOptions): AiMcpServerDecl;
}

/**
 * Snapshot of AI decls registered since the last reset.
 */
export function listAiDecls(): {
  readonly models: readonly AiModelDecl[];
  readonly prompts: readonly AiPromptDecl[];
  readonly embeds: readonly AiEmbedDecl[];
  readonly agents: readonly AiAgentDecl[];
  readonly deciders: readonly AiDeciderDecl[];
  readonly decisions: readonly AiDecisionDecl[];
  readonly mcpServers: readonly AiMcpServerDecl[];
} {
  return {
    models: aiModelRegistry.slice(),
    prompts: aiPromptRegistry.slice(),
    embeds: aiEmbedRegistry.slice(),
    agents: aiAgentRegistry.slice(),
    deciders: aiDeciderRegistry.slice(),
    decisions: aiDecisionRegistry.slice(),
    mcpServers: aiMcpServerRegistry.slice(),
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
  aiDeciderRegistry.length = 0;
  aiDecisionRegistry.length = 0;
  aiMcpServerRegistry.length = 0;
}

/**
 * AI element namespace.
 */
export const ai = {
  /**
   * Declare a model binding.
   *
   * @param name - Logical model name (`smart`, `fast`, …)
   * @param options - Provider / tier / model id
   */
  model(name: string, options: AiModelOptions = {}): AiModelDecl {
    if (!name) throw new TypeError("ai.model: name is required");
    const resolved = resolveAiModelBaseUrl({
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.baseUrl !== undefined ? { baseUrl: options.baseUrl } : {}),
      ...(options.driverId !== undefined ? { driverId: options.driverId } : {}),
    });
    if (resolved.tier2Caveat !== undefined && resolved.tier2Provider !== undefined) {
      console.warn(
        formatAiProviderTier2Warn(resolved.tier2Provider, resolved.tier2Caveat, "ai.model"),
      );
    }
    const baseUrl = resolved.baseUrl;
    const decl: AiModelDecl = {
      kind: "model",
      name,
      ...(options.provider !== undefined ? { provider: options.provider } : {}),
      ...(options.tier !== undefined ? { tier: options.tier } : {}),
      ...(options.model !== undefined ? { model: options.model } : {}),
      ...(baseUrl !== undefined ? { baseUrl } : {}),
      ...(options.apiKey !== undefined ? { apiKey: options.apiKey } : {}),
      ...(options.driverId !== undefined ? { driverId: options.driverId } : {}),
      prompt(promptName, promptOpts = {}) {
        const promptDecl: AiPromptDecl = {
          kind: "prompt",
          name: promptName,
          model: name,
          ...(promptOpts.version !== undefined ? { version: promptOpts.version } : {}),
          ...(promptOpts.evals !== undefined ? { evals: promptOpts.evals } : {}),
          ...(promptOpts.budget !== undefined ? { budget: promptOpts.budget } : {}),
          ...(promptOpts.repair !== undefined ? { repair: promptOpts.repair } : {}),
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
    const approvals: Record<string, AiAgentApprovalDecl> = {};
    for (const tool of options.tools ?? []) {
      if (typeof tool === "string" || !("approval" in tool) || tool.approval === undefined) {
        continue;
      }
      if (tool.approval === false) continue;
      if (tool.gate === undefined) {
        throw new TypeError(`ai.agent("${name}"): tool "${toolName(tool)}" approval requires gate`);
      }
      approvals[toolName(tool)] = {
        gate: gateName(tool.gate),
        timeout: tool.timeout ?? "24h",
        ...(typeof tool.approval === "function" ? { when: tool.approval } : {}),
      };
    }
    const decl: AiAgentDecl = {
      kind: "agent",
      name,
      tools: (options.tools ?? []).map(toolName),
      ...(Object.keys(approvals).length > 0 ? { approvals } : {}),
      ...(options.maxSteps !== undefined ? { maxSteps: options.maxSteps } : {}),
      ...(options.maxDepth !== undefined ? { maxDepth: options.maxDepth } : {}),
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

  decider(name: string, options: AiDeciderOptions): AiDeciderDecl {
    const decl = buildDeciderDecl(name, options);
    aiDeciderRegistry.push(decl);
    return decl;
  },

  decision(name: string, options: AiDecisionOptions): AiDecisionDecl {
    const decl = buildDecisionDecl(name, options);
    aiDecisionRegistry.push(decl);
    return decl;
  },

  choice(instructions: string, options: Readonly<Record<string, string | null>>): AiChoiceQuestion {
    return { kind: "choice", instructions, options };
  },

  score(instructions: string, levels: readonly string[]): AiScoreQuestion {
    return { kind: "score", instructions, levels };
  },

  boolean(
    instructions: string,
    criteria?: { readonly true?: string; readonly false?: string },
  ): AiBooleanQuestion {
    return { kind: "boolean", instructions, ...(criteria !== undefined ? { criteria } : {}) };
  },

  /**
   * Declare an external MCP server whose allowlisted tools join `fx.call`.
   *
   * @param name - Server id
   * @param options - Transport + required tool allowlist
   */
  mcpServer(name: string, options: AiMcpServerOptions): AiMcpServerDecl {
    if (!name) throw new TypeError("ai.mcpServer: name is required");
    if (name.includes("/") || name.includes("__")) {
      throw new TypeError(`ai.mcpServer: name "${name}" must not contain "/" or "__"`);
    }
    if (!options.tools || !Array.isArray(options.tools)) {
      throw new TypeError("ai.mcpServer: tools allowlist is required");
    }
    const hasUrl = typeof options.url === "string" && options.url.length > 0;
    const hasCommand = typeof options.command === "string" && options.command.length > 0;
    if (hasUrl === hasCommand) {
      throw new TypeError("ai.mcpServer: declare exactly one of url or command");
    }
    const allow = new Set(options.tools);
    const authName =
      typeof options.auth?.bearer === "string" ? options.auth.bearer : options.auth?.bearer?.name;
    const decl: AiMcpServerDecl = {
      kind: "mcp-server",
      name,
      ...(hasUrl ? { url: options.url } : {}),
      ...(hasCommand ? { command: options.command } : {}),
      ...(options.args !== undefined ? { args: options.args } : {}),
      ...(authName !== undefined ? { auth: authName } : {}),
      tools: options.tools,
      tool(tool: string): AiMcpToolRef {
        if (!allow.has(tool)) {
          throw new TypeError(`ai.mcpServer("${name}"): tool "${tool}" is not in the allowlist`);
        }
        return { name: mcpToolRef(name, tool) };
      },
    };
    aiMcpServerRegistry.push(decl);
    return decl;
  },
} as AiNamespace;

/**
 * Validate a decision and return the registered shape.
 *
 * @param name - Decision id
 * @param options - Author options
 */
/**
 * Validate a decider and return the registered shape.
 *
 * @param name - Decider id
 * @param options - Author options
 */
export function buildDeciderDecl(name: string, options: AiDeciderOptions): AiDeciderDecl {
  if (!name) throw new TypeError("ai.decider: name is required");
  const resolved = resolveDecider(name, options);
  return { kind: "decider", name, ...resolved };
}

/**
 * Validate a decision and return the registered shape.
 *
 * @param name - Decision id
 * @param options - Author options
 */
export function buildDecisionDecl(name: string, options: AiDecisionOptions): AiDecisionDecl {
  if (!name) throw new TypeError("ai.decision: name is required");
  if ("shadow" in options && options.shadow !== undefined) {
    throw new TypeError(`ai.decision("${name}"): shadow is planned`);
  }
  if (!options.decider || options.decider.kind !== "decider") {
    throw new TypeError(`ai.decision("${name}"): decider is required`);
  }
  if (options.otherwise === undefined) {
    throw new TypeError(`ai.decision("${name}"): otherwise is required`);
  }
  const keys = Object.keys(options.ask ?? {});
  if (keys.length === 0) throw new TypeError(`ai.decision("${name}"): ask is empty`);
  if (options.autonomy !== undefined && options.autonomy.audit === undefined) {
    throw new TypeError(`ai.decision("${name}"): autonomy requires audit`);
  }
  const chain = [options.decider, ...(options.backup ?? [])];
  for (const key of keys) {
    if (key === "meta" || key === "$") {
      throw new TypeError(`ai.decision("${name}"): question id "${key}" is reserved`);
    }
    const question = options.ask[key];
    if (!question) continue;
    for (const decider of chain) {
      assertQuestionFits(name, key, question, decider);
    }
  }
  const abstain = options.otherwise === "abstain";
  const review = abstain
    ? undefined
    : typeof options.otherwise === "string"
      ? options.otherwise
      : options.otherwise.name;
  const secrets = [...new Set(chain.map((decider) => decider.secret))].sort();
  return {
    kind: "decision",
    name,
    ask: options.ask,
    mode: abstain ? "abstain" : "review",
    ...(review !== undefined ? { review } : {}),
    decider: options.decider.name,
    backup: (options.backup ?? []).map((decider) => decider.name),
    otherwise: abstain ? "abstain" : (review ?? ""),
    secrets,
    ...(options.autonomy !== undefined ? { autonomy: options.autonomy } : {}),
    ...(options.evals !== undefined ? { evals: options.evals } : {}),
    ...(options.locale !== undefined ? { locale: options.locale } : {}),
    ...(options.in !== undefined ? { inputSchema: options.in } : {}),
  };
}

function assertQuestionFits(
  decision: string,
  key: string,
  question: AiDecisionQuestion,
  decider: AiDeciderDecl,
): void {
  const caps = decider.capabilities;
  if (question.kind === "boolean" && !caps.boolean) {
    throw new TypeError(
      `ai.decision("${decision}"): decider "${decider.name}" cannot answer boolean "${key}"`,
    );
  }
  if (question.kind === "choice") {
    if (!caps.choice) {
      throw new TypeError(
        `ai.decision("${decision}"): decider "${decider.name}" cannot answer choice "${key}"`,
      );
    }
    const count = Object.keys(question.options).length;
    if (typeof caps.maxChoices === "number" && count > caps.maxChoices) {
      throw new TypeError(
        `ai.decision("${decision}"): choice "${key}" has ${count} options; decider "${decider.name}" allows ${caps.maxChoices}`,
      );
    }
    if (Object.prototype.hasOwnProperty.call(question.options, "none_of_these")) {
      throw new TypeError(`ai.decision("${decision}"): choice "${key}" must not set none_of_these`);
    }
  }
  if (question.kind === "score") {
    if (!caps.score) {
      throw new TypeError(
        `ai.decision("${decision}"): decider "${decider.name}" cannot answer score "${key}"`,
      );
    }
    const count = question.levels.length;
    if (typeof caps.minLevels === "number" && count < caps.minLevels) {
      throw new TypeError(
        `ai.decision("${decision}"): score "${key}" has ${count} levels; decider "${decider.name}" needs at least ${caps.minLevels}`,
      );
    }
    if (typeof caps.maxLevels === "number" && count > caps.maxLevels) {
      throw new TypeError(
        `ai.decision("${decision}"): score "${key}" has ${count} levels; decider "${decider.name}" allows ${caps.maxLevels}`,
      );
    }
  }
}
