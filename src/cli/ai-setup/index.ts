/**
 * `oke ai setup` — interactive AI provider + model configuration.
 */

import { cancel, intro, outro, spinner } from "@clack/prompts";
import { applyAiSetup, type AiSetupApplyInput } from "./apply.ts";
import { cloudApplyDefaults, CLOUD_PROVIDERS } from "./catalog.ts";
import { askAiSetup } from "./prompts.ts";

/** Parsed flags for AI setup. */
export type AiSetupCliArgs = {
  readonly help: boolean;
  readonly yes: boolean;
  readonly provider?: string;
  readonly chat?: string;
  readonly vision?: string;
  readonly embed?: string;
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

  return { help, yes, provider, chat, vision, embed, cwd };
}

/**
 * Help text for `oke ai setup`.
 */
export function aiSetupHelp(): string {
  const cloudIds = CLOUD_PROVIDERS.map((p) => p.value).join(" | ");
  return `oke ai setup — configure AI driver + models

Usage:
  oke ai setup
  oke ai setup --provider openrouter --yes
  oke ai setup --provider custom --yes
  oke ai setup --provider anthropic --chat claude-sonnet-4-20250514 --yes

Options:
  --provider <id>   ${cloudIds}
  --chat <model>    Chat model id
  --vision <model>  Vision model id
  --embed <model>   Embedding model id
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
  const base = cloudApplyDefaults(args.provider!, {
    ...(args.chat !== undefined ? { chatModel: args.chat } : {}),
  });
  return {
    ...base,
    ...(args.vision !== undefined ? { visionModel: args.vision || null } : {}),
    ...(args.embed !== undefined ? { embedModel: args.embed } : {}),
  };
}
