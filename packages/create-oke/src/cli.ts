/**
 * `create-oke` CLI — standard|advanced Notes starters with recommended / reuse / customize.
 *
 * ```bash
 * bunx create-oke@latest <name> [--template standard|advanced]
 * bunx create-oke@latest <name> --yes
 * bunx create-oke@latest   # interactive when stdin is a TTY
 * ```
 */

import {
  cancel,
  confirm,
  intro,
  isCancel,
  log,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { basename, relative, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { agentsMdContent } from "./agents-md.ts";
import {
  createDefaultsPath,
  readCreateDefaults,
  writeCreateDefaults,
  type CreateDefaults,
  type EnvDriverPins,
} from "./create-defaults.ts";
import { docsUrl } from "./docs-origin.ts";
import { applyAiSetup, type AiSetupApplyInput } from "./ai-setup/apply.ts";
import {
  aiPrefWithModels,
  applyInputFromAiPref,
  nonInteractiveAiApply,
} from "./ai-setup/from-pref.ts";
import { askAiSetup } from "./ai-setup/prompts.ts";
import { askCustomizeFlow } from "./customize-flow.ts";
import { recommendedDefaults } from "./drivers-catalog.ts";
import { parseExtraLocales } from "./locales.ts";
import {
  scaffold,
  targetDirectoryBlockReason,
  type ScaffoldResult,
  type ScaffoldSource,
} from "./scaffold.ts";
import {
  DEFAULT_TEMPLATE,
  TEMPLATE_PURPOSES,
  TEMPLATES,
  isTemplateId,
  type TemplateId,
} from "./templates.ts";
import { DEFAULT_SQL_DRIVER, SQL_DRIVERS, isSqlDriverId, type SqlDriverId } from "./transform.ts";
import { WIZARD_BACK } from "./wizard-select.ts";
export { WIZARD_BACK, selectWithBack, withBackOption, type WizardBack } from "./wizard-select.ts";

/** How AI setup is requested on the CLI. */
export type AiCliMode = "prompt" | "skip" | "force";

/** Parsed CLI arguments. */
export type CliArgs = {
  readonly name: string | undefined;
  readonly template: TemplateId;
  /** True when `--template` / `-t` was present on the argv. */
  readonly templateExplicit: boolean;
  /** Store SQL driver (`postgres` default). */
  readonly sqlDriver: SqlDriverId;
  /** True when `--sql` was present on the argv. */
  readonly sqlDriverExplicit: boolean;
  readonly help: boolean;
  /** Skip all prompts; use defaults. */
  readonly yes: boolean;
  /**
   * Install after scaffold.
   * `undefined` = default (interactive asks; `--yes` installs; else skip).
   */
  readonly install: boolean | undefined;
  /** Write `AGENTS.md` (default true). */
  readonly agentsMd: boolean;
  /** AI setup after install. */
  readonly ai: AiCliMode;
  /** Extra locales beyond English (`--locales ar,fr`). */
  readonly locales: readonly string[];
  /**
   * PgDog pooling flag from CLI.
   * `undefined` = ask (interactive) / off (`--yes`).
   */
  readonly pgdog: boolean | undefined;
  readonly targetDir: string | undefined;
};

/** Defaults-branch choice after project name. */
export type DefaultsBranch = "recommended" | "reuse" | "customize";

/** One Clack option for the recommended / reuse / customize branch. */
export type DefaultsBranchOption = {
  readonly value: DefaultsBranch;
  readonly label: string;
  readonly hint: string;
};

/**
 * Build the defaults-branch menu. **Reuse** appears only when previous
 * settings exist for the selected template.
 *
 * @param hasPreviousForTemplate - Matching create-defaults on disk
 * @param template - Selected starter
 */
export function defaultsBranchOptions(
  hasPreviousForTemplate: boolean,
  template: TemplateId = "standard",
): DefaultsBranchOption[] {
  const options: DefaultsBranchOption[] = [
    {
      value: "recommended",
      label: "Yes, use recommended defaults",
      hint:
        template === "advanced"
          ? "Notes · Docker-first pins · store.index"
          : "Notes · Docker-first pins (postgres · redis · s3)",
    },
  ];
  if (hasPreviousForTemplate) {
    options.push({
      value: "reuse",
      label: "No, reuse previous settings",
      hint: `~/.oke/create-defaults.json (${template})`,
    });
  }
  options.push({
    value: "customize",
    label: "No, customize settings",
    hint: template === "standard" ? "dev/prod SQL · optional AI" : "dev/prod facets · optional AI",
  });
  return options;
}

/** Answers collected by the interactive ask step (no clack types). */
export type InteractiveAnswers = {
  readonly name: string;
  readonly choice: TemplateId;
  readonly installAndRun: boolean;
  readonly agentsMd: boolean;
  /** `undefined` = recommended template defaults (no createDefaults apply). */
  readonly createDefaults: CreateDefaults | undefined;
  /** Model / env apply payload — written after scaffold, before install. */
  readonly aiApply: AiSetupApplyInput | null;
  /** Extra locales beyond English (empty = English only). */
  readonly locales: readonly string[];
  /** Pin PgDog in front of Postgres. */
  readonly pgdog: boolean;
};

/**
 * Canonical scaffold invocation — shared by interactive and flag-driven paths.
 */
export type ScaffoldCallArgs = {
  readonly name: string;
  readonly targetDir: string;
  readonly source: ScaffoldSource;
  readonly agentsMd: boolean;
  readonly sqlDriver: SqlDriverId;
  readonly createDefaults?: CreateDefaults;
  /** Apply AI models in `src/core.ts` + `.env.local` after scaffold (before install). */
  readonly aiApply?: AiSetupApplyInput | null;
  /** Extra locales beyond English. */
  readonly locales?: readonly string[];
  /** Pin PgDog in front of Postgres. */
  readonly pgdog?: boolean;
};

/**
 * Parse argv after the binary name.
 *
 * @param argv - Process arguments (no node/bun binary)
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let name: string | undefined;
  let template: TemplateId = DEFAULT_TEMPLATE;
  let templateExplicit = false;
  let sqlDriver: SqlDriverId = DEFAULT_SQL_DRIVER;
  let sqlDriverExplicit = false;
  let help = false;
  let yes = false;
  let install: boolean | undefined;
  let agentsMd = true;
  let ai: AiCliMode = "prompt";
  let locales: readonly string[] = [];
  let pgdog: boolean | undefined;
  let targetDir: string | undefined;

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
    if (a === "--install") {
      install = true;
      continue;
    }
    if (a === "--no-install") {
      install = false;
      continue;
    }
    if (a === "--no-agents-md") {
      agentsMd = false;
      continue;
    }
    if (a === "--agents-md") {
      agentsMd = true;
      continue;
    }
    if (a === "--no-ai" || a === "--ai=skip") {
      ai = "skip";
      continue;
    }
    if (a === "--ai") {
      const next = argv[i + 1];
      if (next === "skip") {
        i++;
        ai = "skip";
        continue;
      }
      ai = "force";
      continue;
    }
    if (a.startsWith("--ai=")) {
      const value = a.slice("--ai=".length);
      if (value === "skip") ai = "skip";
      else ai = "force";
      continue;
    }
    if (a === "--sql") {
      const next = argv[++i];
      if (!next || !isSqlDriverId(next)) {
        throw new Error(`create-oke: --sql must be one of ${SQL_DRIVERS.join("|")}`);
      }
      sqlDriver = next;
      sqlDriverExplicit = true;
      continue;
    }
    if (a.startsWith("--sql=")) {
      const value = a.slice("--sql=".length);
      if (!isSqlDriverId(value)) {
        throw new Error(`create-oke: --sql must be one of ${SQL_DRIVERS.join("|")}`);
      }
      sqlDriver = value;
      sqlDriverExplicit = true;
      continue;
    }
    if (a === "--template" || a === "-t") {
      const next = argv[++i];
      if (!next || !isTemplateId(next)) {
        throw new Error(`create-oke: --template must be one of ${TEMPLATES.join("|")}`);
      }
      template = next;
      templateExplicit = true;
      continue;
    }
    if (a.startsWith("--template=")) {
      const value = a.slice("--template=".length);
      if (!isTemplateId(value)) {
        throw new Error(`create-oke: --template must be one of ${TEMPLATES.join("|")}`);
      }
      template = value;
      templateExplicit = true;
      continue;
    }
    if (a === "--locales") {
      const next = argv[++i];
      if (!next) throw new Error("create-oke: --locales requires a value (e.g. ar or ar,fr)");
      const parsed = parseExtraLocales(next);
      if (parsed === null) {
        throw new Error("create-oke: --locales must be BCP-47 tags like ar or ar,fr");
      }
      locales = parsed;
      continue;
    }
    if (a.startsWith("--locales=")) {
      const value = a.slice("--locales=".length);
      const parsed = parseExtraLocales(value);
      if (parsed === null) {
        throw new Error("create-oke: --locales must be BCP-47 tags like ar or ar,fr");
      }
      locales = parsed;
      continue;
    }
    if (a === "--pgdog") {
      pgdog = true;
      continue;
    }
    if (a === "--no-pgdog") {
      pgdog = false;
      continue;
    }
    if (a.startsWith("-")) {
      throw new Error(`create-oke: unknown option ${a}`);
    }
    if (name === undefined) {
      name = a;
      continue;
    }
    throw new Error(`create-oke: unexpected argument ${a}`);
  }

  if (argv.includes("--install") && argv.includes("--no-install")) {
    throw new Error("create-oke: use either --install or --no-install, not both");
  }
  if (argv.includes("--pgdog") && argv.includes("--no-pgdog")) {
    throw new Error("create-oke: use either --pgdog or --no-pgdog, not both");
  }

  if (name !== undefined) {
    targetDir = resolve(name);
  }

  return {
    name,
    template,
    templateExplicit,
    sqlDriver,
    sqlDriverExplicit,
    help,
    yes,
    install,
    agentsMd,
    ai,
    locales,
    pgdog,
    targetDir,
  };
}

/**
 * Path for the post-scaffold `cd` line — relative when under cwd, else absolute.
 *
 * @param targetDir - Absolute project directory
 */
export function formatCdPath(targetDir: string): string {
  const rel = relative(process.cwd(), targetDir);
  if (!rel || rel.startsWith("..") || rel.includes("..")) return targetDir;
  return rel;
}

/**
 * Post-scaffold next-steps block — shared by interactive and flag-driven paths.
 *
 * @param result - Successful scaffold result
 */
export function nextStepsText(result: ScaffoldResult): string {
  return `
Scaffolded ${result.label} → ${result.targetDir}

Next steps:

  cd ${formatCdPath(result.targetDir)}
  bun install
  oke schema generate   # system stubs → .oke/schema/oke.ts (also runs on db push)
  oke dev               # app :6530 · Console :6533 · MCP :6535

Docs: ${docsUrl("/docs")}
`;
}

/**
 * Help text — next steps match four-applications.md (`bun install` · `oke dev`).
 */
export function helpText(): string {
  const templateLines = TEMPLATES.map(
    (id) =>
      `  ${id.padEnd(12)}${TEMPLATE_PURPOSES[id]}${id === DEFAULT_TEMPLATE ? "  (default)" : ""}`,
  ).join("\n");
  return `create-oke — scaffold an okengine app

Usage:
  bunx create-oke@latest <name> [--template standard|advanced]
  bunx create-oke@latest <name> --yes
  bunx create-oke@latest          # interactive (TTY only)

Options:
  -t, --template <id>   Clean starter (default: ${DEFAULT_TEMPLATE})
  --sql <id>            Store SQL dialect: ${SQL_DRIVERS.join("|")} (default)
                        Pins store.sql dev/prod (test stays pglite).
  -y, --yes             No prompts; defaults + bun install (no oke dev)
  --install             Run bun install after scaffold
  --no-install          Skip bun install
  --agents-md           Write AGENTS.md (default)
  --no-agents-md        Skip AGENTS.md
  --ai                  Configure AI in the wizard (models before install)
  --no-ai, --ai skip    Skip AI configuration
  --locales <tags>      Extra languages beyond English (e.g. ar or ar,fr)
  --pgdog               Pin PgDog pooling in front of Postgres
  --no-pgdog            Skip PgDog (default for --yes)
  -h, --help            Show this help

Template:
${templateLines}

On a TTY: pick standard|advanced, then recommended defaults, customize
(Docker-first facets; store.index with none; AI setup Recommended /
Customize / Off), optional extra locales + PgDog pooling, or reuse when
saved for that template. Locales + PgDog (and customize pins) write to
~/.oke/create-defaults.json on every TTY run.
Non-TTY / --yes stay English-only / no PgDog unless --locales / --pgdog.
`;
}

/**
 * Whether the CLI should open the interactive Clack flow.
 *
 * @param args - Parsed args
 * @param stdinIsTTY - `process.stdin.isTTY`
 */
export function shouldPrompt(args: CliArgs, stdinIsTTY: boolean | undefined): boolean {
  if (!stdinIsTTY) return false;
  if (args.help) return false;
  if (args.yes) return false;
  if (args.templateExplicit) return false;
  return true;
}

/**
 * Build the {@link ScaffoldSource} for a flag-driven invocation.
 *
 * @param args - Parsed args
 */
export function sourceFromArgs(args: CliArgs): ScaffoldSource {
  return { kind: "template", id: args.template };
}

/**
 * Map flag-driven {@link CliArgs} to scaffold call args.
 *
 * @param args - Parsed CLI args with `name` set
 */
export function scaffoldArgsFromCli(args: CliArgs): ScaffoldCallArgs {
  if (args.name === undefined || args.targetDir === undefined) {
    throw new Error("create-oke: missing <name>");
  }
  return {
    name: basename(resolve(args.name)),
    targetDir: args.targetDir,
    source: sourceFromArgs(args),
    agentsMd: args.agentsMd,
    sqlDriver: args.sqlDriver,
    aiApply: args.ai === "force" ? nonInteractiveAiApply("llama-cpp") : null,
    locales: args.locales,
    pgdog: args.pgdog ?? false,
  };
}

/**
 * Pure map from interactive answers → scaffold call args.
 *
 * @param answers - Collected interactive answers
 * @param sqlDriverOverride - Optional `--sql` flag merge
 */
export function scaffoldArgsFromAnswers(
  answers: InteractiveAnswers,
  sqlDriverOverride?: SqlDriverId,
): ScaffoldCallArgs {
  const targetDir = resolve(answers.name.trim());
  const name = basename(targetDir);
  let createDefaults = answers.createDefaults;
  let sqlDriver: SqlDriverId = DEFAULT_SQL_DRIVER;

  if (createDefaults && sqlDriverOverride === "postgres") {
    createDefaults = {
      ...createDefaults,
      drivers: {
        ...createDefaults.drivers,
        store: {
          ...createDefaults.drivers.store,
          sql: {
            dev: "postgres",
            test: createDefaults.drivers.store.sql.test,
            prod: "postgres",
          },
        },
      },
    };
    sqlDriver = "postgres";
  } else if (!createDefaults && sqlDriverOverride) {
    sqlDriver = sqlDriverOverride;
  } else if (createDefaults?.drivers.store.sql.dev === "postgres") {
    sqlDriver = "postgres";
  }

  return {
    name,
    targetDir,
    source: { kind: "template", id: answers.choice },
    agentsMd: answers.agentsMd,
    sqlDriver,
    ...(createDefaults !== undefined ? { createDefaults } : {}),
    aiApply: answers.aiApply,
    locales: answers.locales,
    pgdog: answers.pgdog,
  };
}

/**
 * Ask step — clack prompts only. Returns answers or `null` on cancel.
 *
 * @param partial - Name already known (pre-filled in the prompt)
 */
export type AskInteractiveFn = (partial: {
  readonly name?: string;
  readonly agentsMd?: boolean;
  readonly sqlDriver?: SqlDriverId;
  readonly ai?: AiCliMode;
  readonly template?: TemplateId;
  readonly locales?: readonly string[];
  readonly pgdog?: boolean;
}) => Promise<InteractiveAnswers | null>;

/** Injectable persistence seams for tests. */
export type CreateDefaultsIo = {
  readonly path: string;
  readonly read: () => CreateDefaults | null;
  readonly write: (defaults: CreateDefaults) => void;
};

/**
 * Merge wizard locales / PgDog into a create-defaults document to persist.
 *
 * Prefer the in-session answers (customize / reuse), else same-template
 * previous settings, else recommended pins for the template.
 *
 * @param input - Template, locales, pgdog, and optional session / previous docs
 */
export function withLocalesPgDog(input: {
  readonly template: TemplateId;
  readonly locales: readonly string[];
  readonly pgdog: boolean;
  readonly session: CreateDefaults | undefined;
  readonly previous: CreateDefaults | null;
}): CreateDefaults {
  const { template, locales, pgdog, session, previous } = input;
  const base =
    session ??
    (previous?.template === template ? previous : null) ??
    recommendedDefaults("docker-ready", template);
  return {
    ...base,
    template,
    locales,
    pgdog,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Collect interactive answers via `@clack/prompts`.
 *
 * @param partial - Optional pre-filled project name / agents-md default
 * @param io - Persistence seams (tests)
 * @returns Answers, or `null` if the user cancelled
 */
export async function askInteractiveAnswers(
  partial: {
    readonly name?: string;
    readonly agentsMd?: boolean;
    readonly sqlDriver?: SqlDriverId;
    readonly ai?: AiCliMode;
    readonly template?: TemplateId;
    readonly locales?: readonly string[];
    readonly pgdog?: boolean;
  } = {},
  io: CreateDefaultsIo = {
    path: createDefaultsPath(),
    read: () => readCreateDefaults(),
    write: (d) => writeCreateDefaults(d),
  },
): Promise<InteractiveAnswers | null> {
  const nameValue = await text({
    message: "Project name",
    placeholder: "my-app",
    initialValue: partial.name ?? "my-app",
    validate: (value) => {
      if (!value?.trim()) return "Project name is required";
      const blocked = targetDirectoryBlockReason(resolve(value.trim()));
      if (blocked) {
        return blocked.replace(/^create-oke:\s*/, "");
      }
      return undefined;
    },
  });
  if (isCancel(nameValue)) return null;
  const name = String(nameValue).trim();

  const templateValue = await select({
    message: "Starter template",
    options: TEMPLATES.map((id) => ({
      value: id,
      label: id === "standard" ? "standard" : "advanced",
      hint: TEMPLATE_PURPOSES[id],
    })),
    initialValue: partial.template ?? DEFAULT_TEMPLATE,
  });
  if (isCancel(templateValue)) return null;
  const template = templateValue as TemplateId;

  let createDefaults: CreateDefaults | undefined;
  let aiApply: AiSetupApplyInput | null = null;
  let persistDefaults = false;

  for (;;) {
    const previous = io.read();
    const canReuse = previous !== null && previous.template === template;
    const branchValue = await select({
      message: "Would you like to use the recommended oke defaults?",
      options: defaultsBranchOptions(canReuse, template),
    });
    if (isCancel(branchValue)) return null;
    const branch = branchValue as DefaultsBranch;

    if (branch === "recommended") {
      createDefaults = undefined;
      break;
    }

    if (branch === "reuse") {
      const prev = io.read() ?? previous;
      if (!prev || prev.template !== template) {
        note(
          "No saved settings for this template — customize or use recommended.",
          "Previous settings",
        );
        continue;
      }
      createDefaults = prev;
      if (prev.ai.enabled && partial.ai !== "skip") {
        aiApply = applyInputFromAiPref(prev.ai);
        if (!aiApply?.chatModel && prev.ai.provider && prev.ai.provider !== "mock") {
          const picked = await askAiSetup({ provider: prev.ai.provider });
          if (picked === null) return null;
          aiApply = picked;
          io.write({
            ...prev,
            ai: aiPrefWithModels(prev.ai, picked),
            updatedAt: new Date().toISOString(),
          });
        }
      }
      note(`Reusing settings from ${io.path}`, "Previous settings");
      break;
    }

    const customized = await askCustomizeFlow(template);
    if (customized === null) return null;
    if (customized === WIZARD_BACK) continue;
    createDefaults = customized;
    persistDefaults = true;
    if (customized.ai.enabled && partial.ai !== "skip") {
      aiApply = applyInputFromAiPref(customized.ai);
    }
    break;
  }

  if (partial.ai === "skip") {
    aiApply = null;
  } else if (partial.ai === "force" && !aiApply) {
    const picked = await askAiSetup({});
    if (picked === null) return null;
    aiApply = picked;
  }

  const locales = await askExtraLocales(partial.locales ?? createDefaults?.locales ?? []);
  if (locales === null) return null;

  const usesPostgres = createDefaults
    ? createDefaults.drivers.store.sql.dev === "postgres" ||
      createDefaults.drivers.store.sql.prod === "postgres" ||
      createDefaults.drivers.store.sql.dev === "pgvector" ||
      createDefaults.drivers.store.sql.prod === "pgvector"
    : true;
  let pgdog = false;
  if (usesPostgres) {
    if (partial.pgdog !== undefined) {
      pgdog = partial.pgdog;
    } else {
      const picked = await askPgDog(createDefaults?.pgdog ?? false);
      if (picked === null) return null;
      pgdog = picked;
    }
  }

  // Locales / PgDog are asked on every TTY run — always persist them so reuse
  // (and recommended) keep the last answers in ~/.oke/create-defaults.json.
  const persisted = withLocalesPgDog({
    template,
    locales,
    pgdog,
    session: createDefaults,
    previous: io.read(),
  });
  if (createDefaults) {
    createDefaults = persisted;
  }
  io.write(persisted);
  if (persistDefaults) {
    note(`Saved globally for next projects → ${io.path}`, "Defaults");
  }

  const agentsMd = partial.agentsMd ?? true;

  const installAndRunValue = await confirm({
    message: "Install dependencies and start oke dev?",
    initialValue: true,
  });
  if (isCancel(installAndRunValue)) return null;

  return {
    name,
    choice: template,
    installAndRun: Boolean(installAndRunValue),
    agentsMd,
    createDefaults,
    aiApply,
    locales,
    pgdog,
  };
}

/**
 * Ask whether to add languages beyond English, then collect BCP-47 tags.
 *
 * @param initialExtra - Prefill from reused create-defaults
 * @returns Extra locale tags, or `null` on cancel
 */
async function askExtraLocales(
  initialExtra: readonly string[] = [],
): Promise<readonly string[] | null> {
  const addMore = await confirm({
    message: "Add more languages besides English?",
    initialValue: initialExtra.length > 0,
  });
  if (isCancel(addMore)) return null;
  if (!addMore) return [];

  const raw = await text({
    message: "Language codes (comma-separated)",
    placeholder: "ar",
    initialValue: initialExtra.length > 0 ? initialExtra.join(",") : "ar",
    validate: (value) => {
      if (!value?.trim()) return "Enter at least one code (e.g. ar or ar,fr)";
      if (parseExtraLocales(value) === null) {
        return "Use BCP-47 tags like ar or ar,fr";
      }
      return undefined;
    },
  });
  if (isCancel(raw)) return null;
  return parseExtraLocales(String(raw)) ?? [];
}

/**
 * Ask whether to put PgDog in front of Postgres.
 *
 * @param initial - Prefill from reused create-defaults
 * @returns `true` to pin PgDog, or `null` on cancel
 */
async function askPgDog(initial: boolean = false): Promise<boolean | null> {
  const value = await confirm({
    message: "Add PgDog connection pooling in front of Postgres?",
    initialValue: initial,
  });
  if (isCancel(value)) return null;
  return Boolean(value);
}

/**
 * Provider passed to `oke ai setup` — prefer native Ollama when either env uses it.
 *
 * @param menuProvider - Menu id chosen in the wizard
 * @param pins - Resolved driver pins
 */
export function aiSetupProviderFor(menuProvider: string, pins: EnvDriverPins): string {
  if (menuProvider === "ollama" || pins.dev === "ollama" || pins.prod === "ollama") {
    return "ollama";
  }
  if (menuProvider === "llama-cpp") return "llama-cpp";
  if (menuProvider === "vllm" || menuProvider === "sglang") return menuProvider;
  if (menuProvider === "mock") {
    if (pins.dev === "anthropic" || pins.prod === "anthropic") return "anthropic";
    if (pins.dev === "openai-compatible" || pins.prod === "openai-compatible") {
      return "llama-cpp";
    }
  }
  return menuProvider;
}

/**
 * Resolve whether to run `bun install` after scaffold (non-interactive).
 *
 * @param args - Parsed args
 */
export function shouldInstall(args: CliArgs): boolean {
  if (args.install === true) return true;
  if (args.install === false) return false;
  return args.yes;
}

/**
 * Run the CLI.
 *
 * @param argv - Args after the binary
 * @param options - Test seams
 * @returns Exit code
 */
export async function run(
  argv: readonly string[],
  options: {
    readonly stdinIsTTY?: boolean | undefined;
    readonly ask?: AskInteractiveFn;
    /** When false, skip spawning bun install / oke dev (tests). Default true. */
    readonly runPostScaffold?: boolean;
    readonly createDefaultsIo?: CreateDefaultsIo;
  } = {},
): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }

  if (args.help) {
    console.log(helpText());
    return 0;
  }

  const stdinIsTTY = options.stdinIsTTY ?? process.stdin.isTTY;
  if (shouldPrompt(args, stdinIsTTY)) {
    const ask =
      options.ask ??
      ((partial) =>
        askInteractiveAnswers(
          partial,
          options.createDefaultsIo ?? {
            path: createDefaultsPath(),
            read: () => readCreateDefaults(),
            write: (d) => writeCreateDefaults(d),
          },
        ));
    return runInteractive(args, ask, options);
  }

  if (args.name === undefined) {
    console.log(helpText());
    console.error("create-oke: missing <name>. Pass a name, or run in a TTY for the wizard.");
    console.error("  Example: bunx create-oke@latest my-app --yes");
    return 1;
  }

  const cliScaffold = scaffoldArgsFromCli(args);
  const earlyBlock = targetDirectoryBlockReason(cliScaffold.targetDir);
  if (earlyBlock) {
    console.error(earlyBlock);
    return 1;
  }

  if (args.yes) {
    const source = sourceFromArgs(args);
    console.log(
      `Using defaults: ${source.kind}=${source.id} sql=${args.sqlDriver} agents-md=${args.agentsMd} install=${shouldInstall(args)} ai=${args.ai}`,
    );
  }

  return runScaffold({
    ...cliScaffold,
    interactive: false,
    install: shouldInstall(args),
    startDev: false,
    runPostScaffold: options.runPostScaffold ?? true,
  });
}

/**
 * Interactive TTY flow — ask → map answers → scaffold.
 *
 * @param args - Parsed args (name may already be set)
 * @param ask - Injectable ask step
 * @param options - Post-scaffold seams
 */
async function runInteractive(
  args: CliArgs,
  ask: AskInteractiveFn,
  options: { readonly runPostScaffold?: boolean },
): Promise<number> {
  intro("create-oke");

  const answers = await ask({
    name: args.name,
    agentsMd: args.agentsMd,
    sqlDriver: args.sqlDriverExplicit ? args.sqlDriver : undefined,
    ai: args.ai,
    locales: args.locales,
    ...(args.pgdog !== undefined ? { pgdog: args.pgdog } : {}),
  });
  if (answers === null) {
    cancel("Cancelled.");
    return 1;
  }

  return runScaffold({
    ...scaffoldArgsFromAnswers(answers, args.sqlDriverExplicit ? args.sqlDriver : undefined),
    interactive: true,
    install: answers.installAndRun,
    startDev: answers.installAndRun,
    runPostScaffold: options.runPostScaffold ?? true,
  });
}

/**
 * Scaffold with optional spinner / outro, cleaning up on failure or cancel.
 *
 * @param options - Scaffold inputs + interactive / install flags
 */
async function runScaffold(
  options: ScaffoldCallArgs & {
    readonly interactive: boolean;
    readonly install: boolean;
    readonly startDev: boolean;
    readonly runPostScaffold: boolean;
  },
): Promise<number> {
  const {
    name,
    targetDir,
    source,
    agentsMd,
    sqlDriver,
    createDefaults,
    aiApply,
    locales,
    pgdog,
    interactive,
    install,
    startDev,
    runPostScaffold,
  } = options;
  const existed = existsSync(targetDir);
  let spun: ReturnType<typeof spinner> | undefined;

  const cleanup = (): void => {
    if (!existed && existsSync(targetDir)) {
      rmSync(targetDir, { recursive: true, force: true });
    }
  };

  const onSigInt = (): void => {
    spun?.stop("Cancelled.");
    cleanup();
    if (interactive) cancel("Cancelled.");
    process.exit(1);
  };
  process.once("SIGINT", onSigInt);

  try {
    if (interactive) {
      spun = spinner();
      spun.start("Scaffolding…");
    }
    const result = await scaffold({
      targetDir,
      name,
      source,
      writeAgentsMd: agentsMd,
      sqlDriver,
      ...(createDefaults !== undefined ? { createDefaults } : {}),
      ...(locales !== undefined ? { locales } : {}),
      ...(pgdog !== undefined ? { pgdog } : {}),
    });
    if (spun) spun.stop("Scaffolded.");

    // Models were chosen in the wizard — write env + AI models in src/core.ts before install
    // so `--no-install` still gets a complete AI project. Preserve per-env
    // `drivers.ai` pins from customize; flatten only when pins were never written.
    if (runPostScaffold && aiApply) {
      try {
        applyAiSetup(targetDir, aiApply, {
          updateDrivers: createDefaults?.drivers.ai == null,
        });
        if (interactive) log.success("AI configured.");
      } catch (err) {
        if (interactive) log.warn("AI config write failed.");
        console.error(err instanceof Error ? err.message : String(err));
      }
    }

    if (runPostScaffold && install) {
      // Inherit bun's progress — a silent spinner feels stuck on cold caches.
      if (interactive) log.step("Installing dependencies…");
      const installOk = await runCommand(["bun", "install"], targetDir, {
        inherit: interactive,
      });
      if (!installOk) {
        if (interactive) log.error("Install failed.");
        cleanup();
        console.error("create-oke: bun install failed");
        return 1;
      }
      if (interactive) log.success("Installed.");
      // System stubs under `.oke/schema/` — refresh after install so published
      // create-oke (no monorepo import) still gets them; re-run after plugins.
      const schemaOk = await runCommand(["bunx", "oke", "schema", "generate"], targetDir, {
        inherit: false,
      });
      if (interactive) {
        if (schemaOk) log.success("System schema generated (.oke/schema/oke.ts).");
        else log.warn("oke schema generate skipped — run it after plugins / auth tables.");
      }
    }

    const message = nextStepsText(result);
    if (interactive) {
      note(
        [
          `Backend  http://127.0.0.1:6530`,
          `Console  http://127.0.0.1:6533`,
          `MCP      http://127.0.0.1:6535`,
          `Docs     ${docsUrl("/docs")}`,
          agentsMd ? `Agents   AGENTS.md` : undefined,
        ]
          .filter(Boolean)
          .join("\n"),
        "Ports",
      );
      outro(message.trim());
    } else {
      console.log(message);
    }

    if (runPostScaffold && startDev) {
      const ok = await runCommand(["bun", "run", "dev"], targetDir, {
        inherit: true,
      });
      return ok ? 0 : 1;
    }

    return 0;
  } catch (e) {
    spun?.stop("Failed.");
    cleanup();
    console.error(e instanceof Error ? e.message : e);
    return 1;
  } finally {
    process.off("SIGINT", onSigInt);
  }
}

/**
 * Spawn a command in `cwd`.
 *
 * @param cmd - Argv
 * @param cwd - Working directory
 * @param options - Inherit stdio for long-running processes
 */
async function runCommand(
  cmd: readonly string[],
  cwd: string,
  options: { readonly inherit?: boolean } = {},
): Promise<boolean> {
  const proc = Bun.spawn([...cmd], {
    cwd,
    stdout: options.inherit ? "inherit" : "pipe",
    stderr: options.inherit ? "inherit" : "pipe",
    stdin: options.inherit ? "inherit" : undefined,
  });
  const code = await proc.exited;
  if (code !== 0 && !options.inherit) {
    const err = await new Response(proc.stderr).text();
    if (err.trim()) console.error(err);
  }
  return code === 0;
}

/** Re-export for tests that assert agents content shape. */
export { agentsMdContent };
