/**
 * `oke ai setup` — interactive AI provider + model configuration.
 */

import { cancel, intro, outro, spinner } from "@clack/prompts";
import { applyAiSetup, type AiSetupApplyInput } from "./apply.ts";
import { askAiSetup } from "./prompts.ts";

/** Parsed flags for AI setup. */
export type AiSetupCliArgs = {
  readonly help: boolean;
  readonly yes: boolean;
  readonly provider?: string;
  readonly chat?: string;
  readonly vision?: string;
  readonly embed?: string;
  readonly pull: boolean;
  readonly cwd: string;
};

/**
 * Parse argv after `ai setup`.
 *
 * @param argv - Remaining args
 * @param cwd - Project root
 */
export function parseAiSetupArgs(
  argv: readonly string[],
  cwd: string = process.cwd(),
): AiSetupCliArgs {
  let help = false;
  let yes = false;
  let provider: string | undefined;
  let chat: string | undefined;
  let vision: string | undefined;
  let embed: string | undefined;
  let pull = true;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--yes" || a === "-y") {
      yes = true;
      continue;
    }
    if (a === "--no-pull") {
      pull = false;
      continue;
    }
    if (a === "--pull") {
      pull = true;
      continue;
    }
    if (a === "--provider") {
      provider = argv[++i];
      continue;
    }
    if (a.startsWith("--provider=")) {
      provider = a.slice("--provider=".length);
      continue;
    }
    if (a === "--chat") {
      chat = argv[++i];
      continue;
    }
    if (a.startsWith("--chat=")) {
      chat = a.slice("--chat=".length);
      continue;
    }
    if (a === "--vision") {
      vision = argv[++i];
      continue;
    }
    if (a.startsWith("--vision=")) {
      vision = a.slice("--vision=".length);
      continue;
    }
    if (a === "--embed") {
      embed = argv[++i];
      continue;
    }
    if (a.startsWith("--embed=")) {
      embed = a.slice("--embed=".length);
      continue;
    }
    throw new Error(`oke ai setup: unknown option ${a}`);
  }

  return { help, yes, provider, chat, vision, embed, pull, cwd };
}

/**
 * Help text for `oke ai setup`.
 */
export function aiSetupHelp(): string {
  return `oke ai setup — configure AI driver + models

Usage:
  oke ai setup
  oke ai setup --provider ollama --yes
  oke ai setup --provider anthropic --chat claude-sonnet-4-20250514 --yes

Options:
  --provider <id>   ollama | openai | anthropic | gemini | lmstudio | openrouter | custom
  --chat <model>    Chat model id
  --vision <model>  Vision model id (ollama)
  --embed <model>   Embedding model id (ollama)
  --pull / --no-pull  Pull missing Ollama models (default: pull)
  -y, --yes         Non-interactive (requires --provider)
  -h, --help        Show this help
`;
}

/**
 * Run AI setup (interactive or flags).
 *
 * @param args - Parsed args
 * @returns Exit code
 */
export async function runAiSetup(args: AiSetupCliArgs): Promise<number> {
  if (args.help) {
    console.log(aiSetupHelp());
    return 0;
  }

  const tty = Boolean(process.stdin.isTTY);
  let input: AiSetupApplyInput | null = null;

  if (args.yes || !tty) {
    if (!args.provider) {
      console.error("oke ai setup: --provider is required in non-interactive mode");
      return 1;
    }
    input = nonInteractiveInput(args);
  } else {
    intro("oke ai setup");
    input = await askAiSetup({ provider: args.provider });
    if (input === null) {
      cancel("Cancelled.");
      return 1;
    }
    // Flag overrides for models when provided alongside interactive provider
    if (args.chat) input = { ...input, chatModel: args.chat };
    if (args.vision !== undefined) input = { ...input, visionModel: args.vision || null };
    if (args.embed) input = { ...input, embedModel: args.embed };
  }

  if (input === null) return 1;

  if (args.pull && input.driver === "ollama" && (args.yes || !tty) && args.chat) {
    // Non-interactive pull via the server HTTP API (never a host `ollama` CLI).
    const { ensureOllamaModel } = await import("../../docker/ollama-pull.ts");
    const baseUrl =
      input.baseUrl?.trim() || process.env.OKE_AI_URL?.trim() || "http://127.0.0.1:11434";
    const toPull = [input.chatModel, input.visionModel, input.embedModel].filter(
      (m): m is string => typeof m === "string" && m.length > 0,
    );
    for (const id of toPull) {
      console.log(`oke ai setup: pulling ${id} via ${baseUrl}/api/pull…`);
      try {
        await ensureOllamaModel({ url: baseUrl, model: id });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`oke ai setup: pull ${id} failed (continuing) — ${msg}`);
      }
    }
  }

  const spun = tty ? spinner() : undefined;
  spun?.start("Writing AI config…");
  try {
    const result = applyAiSetup(args.cwd, input);
    spun?.stop("AI configured.");
    if (tty) {
      outro(
        `Wrote ${result.aiTsPath}\nDriver ${input.driver}` +
          (input.chatModel ? ` · chat ${input.chatModel}` : ""),
      );
    } else {
      console.log(`oke ai setup: driver=${input.driver} chat=${input.chatModel ?? "—"}`);
    }
    return 0;
  } catch (e) {
    spun?.stop("Failed.");
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}

/**
 * Build apply input from flags (non-interactive).
 *
 * @param args - Parsed args
 */
function nonInteractiveInput(args: AiSetupCliArgs): AiSetupApplyInput {
  const provider = args.provider!;
  if (provider === "ollama") {
    return {
      driver: "ollama",
      baseUrl: process.env.OKE_AI_URL ?? "http://127.0.0.1:11434",
      chatModel: args.chat ?? "gemma4:e4b",
      visionModel: args.vision === undefined ? "qwen3-vl:4b" : args.vision || null,
      embedModel: args.embed ?? "nomic-embed-text",
    };
  }
  if (provider === "anthropic") {
    return {
      driver: "anthropic",
      chatModel: args.chat ?? "claude-sonnet-4-20250514",
      visionModel: null,
      embedModel: null,
      apiKeyEnv: "ANTHROPIC_API_KEY",
    };
  }
  const baseUrls: Record<string, string | undefined> = {
    openai: "https://api.openai.com/v1",
    openrouter: "https://openrouter.ai/api/v1",
    lmstudio: "http://127.0.0.1:1234/v1",
    gemini: undefined,
    custom: undefined,
  };
  return {
    driver: "openai-compatible",
    ...(baseUrls[provider] !== undefined ? { baseUrl: baseUrls[provider] } : {}),
    chatModel: args.chat ?? "gpt-4o-mini",
    visionModel: null,
    embedModel: null,
    apiKeyEnv: "OPENAI_API_KEY",
  };
}
