/**
 * `create-oke` CLI — clean templates by default; teaching examples opt-in.
 *
 * ```bash
 * bunx create-oke@latest <name> [--template hello|minimal|standard|full]
 * bunx create-oke@latest <name> --from-example notes|linkly|provisions|skyport
 * bunx create-oke@latest   # interactive when stdin is a TTY
 * ```
 */

import {
  cancel,
  intro,
  isCancel,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { basename, relative, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { scaffold, type ScaffoldResult, type ScaffoldSource } from "./scaffold.ts";
import {
  DEFAULT_TEMPLATE,
  EXAMPLE_NEW_IDEAS,
  EXAMPLES,
  TEMPLATE_PURPOSES,
  TEMPLATES,
  isExampleId,
  isTemplateId,
  type ExampleId,
  type TemplateId,
} from "./templates.ts";

/** Parsed CLI arguments. */
export type CliArgs = {
  readonly name: string | undefined;
  readonly template: TemplateId;
  readonly fromExample: ExampleId | undefined;
  /** True when `--template` / `-t` was present on the argv. */
  readonly templateExplicit: boolean;
  readonly help: boolean;
  readonly targetDir: string | undefined;
};

/**
 * Sentinel choice for "Start from a worked example" in interactive answers.
 * Distinct from clack's internal select value (`__example__`).
 */
export const FROM_EXAMPLE_CHOICE = "from-example" as const;

/** Answers collected by the interactive ask step (no clack types). */
export type InteractiveAnswers =
  | {
      readonly name: string;
      readonly choice: TemplateId;
    }
  | {
      readonly name: string;
      readonly choice: typeof FROM_EXAMPLE_CHOICE;
      readonly example: ExampleId;
    };

/**
 * Canonical scaffold invocation — shared by interactive and flag-driven paths.
 */
export type ScaffoldCallArgs = {
  readonly name: string;
  readonly targetDir: string;
  readonly source: ScaffoldSource;
};

/**
 * Parse argv after the binary name.
 *
 * @param argv - Process arguments (no node/bun binary)
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let name: string | undefined;
  let template: TemplateId = DEFAULT_TEMPLATE;
  let fromExample: ExampleId | undefined;
  let templateExplicit = false;
  let help = false;
  let targetDir: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === "--help" || a === "-h") {
      help = true;
      continue;
    }
    if (a === "--template" || a === "-t") {
      const next = argv[++i];
      if (!next || !isTemplateId(next)) {
        throw new Error(
          `create-oke: --template must be one of ${TEMPLATES.join("|")}`,
        );
      }
      template = next;
      templateExplicit = true;
      continue;
    }
    if (a.startsWith("--template=")) {
      const value = a.slice("--template=".length);
      if (!isTemplateId(value)) {
        throw new Error(
          `create-oke: --template must be one of ${TEMPLATES.join("|")}`,
        );
      }
      template = value;
      templateExplicit = true;
      continue;
    }
    if (a === "--from-example") {
      const next = argv[++i];
      if (!next || !isExampleId(next)) {
        throw new Error(
          `create-oke: --from-example must be one of ${EXAMPLES.join("|")}`,
        );
      }
      fromExample = next;
      continue;
    }
    if (a.startsWith("--from-example=")) {
      const value = a.slice("--from-example=".length);
      if (!isExampleId(value)) {
        throw new Error(
          `create-oke: --from-example must be one of ${EXAMPLES.join("|")}`,
        );
      }
      fromExample = value;
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

  if (templateExplicit && fromExample !== undefined) {
    throw new Error(
      "create-oke: use either --template or --from-example, not both",
    );
  }

  if (name !== undefined) {
    targetDir = resolve(name);
  }

  return { name, template, fromExample, templateExplicit, help, targetDir };
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
  oke dev          # app :6530 · Console :6533 · MCP :6535
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
  const exampleLines = EXAMPLES.map(
    (id) => `  ${id.padEnd(12)}${EXAMPLE_NEW_IDEAS[id]}`,
  ).join("\n");

  return `create-oke — scaffold an okengine app

Usage:
  bunx create-oke@latest <name> [--template hello|minimal|standard|full]
  bunx create-oke@latest <name> --from-example notes|linkly|provisions|skyport
  bunx create-oke@latest          # interactive (TTY only)

Templates (clean starters from templates/):
${templateLines}

--from-example (copies a teaching example, including its business logic and
comments — most new projects want --template instead):
${exampleLines}

No telemetry. Bun only. Interactive prompts only when stdin is a TTY and no
name / --template / --from-example is given.
`;
}

/**
 * Whether the CLI should open the two-question interactive flow.
 *
 * Mirrors oke / gflows: bare invocation is interactive only in a real terminal;
 * any explicit flag or positional name stays fully scriptable.
 *
 * @param args - Parsed args
 * @param stdinIsTTY - `process.stdin.isTTY`
 */
export function shouldPrompt(
  args: CliArgs,
  stdinIsTTY: boolean | undefined,
): boolean {
  if (!stdinIsTTY) return false;
  if (args.help) return false;
  if (args.name !== undefined) return false;
  if (args.templateExplicit) return false;
  if (args.fromExample !== undefined) return false;
  return true;
}

/**
 * Build the {@link ScaffoldSource} for a flag-driven invocation.
 *
 * @param args - Parsed args
 */
export function sourceFromArgs(args: CliArgs): ScaffoldSource {
  if (args.fromExample !== undefined) {
    return { kind: "example", id: args.fromExample };
  }
  return { kind: "template", id: args.template };
}

/**
 * Map flag-driven {@link CliArgs} to scaffold call args.
 *
 * Requires a positional project name (and thus `targetDir`).
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
  };
}

/**
 * Pure map from interactive answers → scaffold call args.
 *
 * Independent of clack — unit-tested against {@link scaffoldArgsFromCli}
 * for every template and every `--from-example` choice.
 *
 * @param answers - Collected interactive answers
 */
export function scaffoldArgsFromAnswers(
  answers: InteractiveAnswers,
): ScaffoldCallArgs {
  const targetDir = resolve(answers.name.trim());
  const name = basename(targetDir);
  if (answers.choice === FROM_EXAMPLE_CHOICE) {
    return {
      name,
      targetDir,
      source: { kind: "example", id: answers.example },
    };
  }
  return {
    name,
    targetDir,
    source: { kind: "template", id: answers.choice },
  };
}

/**
 * Ask step — clack prompts only. Returns answers or `null` on cancel.
 *
 * Injectable for tests; production uses {@link askInteractiveAnswers}.
 *
 * @param partial - Name already known (skipped in the prompt)
 */
export type AskInteractiveFn = (
  partial: { readonly name?: string },
) => Promise<InteractiveAnswers | null>;

/**
 * Collect interactive answers via `@clack/prompts`.
 *
 * @param partial - Optional pre-filled project name
 * @returns Answers, or `null` if the user cancelled
 */
export async function askInteractiveAnswers(
  partial: { readonly name?: string } = {},
): Promise<InteractiveAnswers | null> {
  let name = partial.name;
  if (name === undefined) {
    const nameValue = await text({
      message: "Project name",
      placeholder: "my-app",
      validate: (value) => {
        if (!value?.trim()) return "Project name is required";
        return undefined;
      },
    });
    if (isCancel(nameValue)) return null;
    name = String(nameValue).trim();
  }

  const templateValue = await select({
    message: "Template",
    options: [
      ...TEMPLATES.map((id) => ({
        value: id as string,
        label: id,
        hint: TEMPLATE_PURPOSES[id],
      })),
      {
        value: "__example__",
        label: "Start from a worked example",
        hint: "Teaching apps with business logic — most projects want a template",
      },
    ],
    initialValue: DEFAULT_TEMPLATE,
  });
  if (isCancel(templateValue)) return null;

  if (templateValue === "__example__") {
    const exampleValue = await select({
      message: "Example",
      options: EXAMPLES.map((id) => ({
        value: id,
        label: id,
        hint: EXAMPLE_NEW_IDEAS[id],
      })),
    });
    if (isCancel(exampleValue)) return null;
    return {
      name,
      choice: FROM_EXAMPLE_CHOICE,
      example: exampleValue as ExampleId,
    };
  }

  return { name, choice: templateValue as TemplateId };
}

/**
 * Run the CLI.
 *
 * @param argv - Args after the binary
 * @param options - Test seams (stdin TTY, ask injection)
 * @returns Exit code
 */
export async function run(
  argv: readonly string[],
  options: {
    readonly stdinIsTTY?: boolean | undefined;
    readonly ask?: AskInteractiveFn;
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
    return runInteractive(args, options.ask ?? askInteractiveAnswers);
  }

  if (args.name === undefined) {
    console.log(helpText());
    console.error("create-oke: missing <name>");
    return 1;
  }

  return runScaffold({
    ...scaffoldArgsFromCli(args),
    interactive: false,
  });
}

/**
 * Interactive TTY flow — ask → map answers → scaffold.
 *
 * @param args - Parsed args (name may already be set if ever called that way)
 * @param ask - Injectable ask step
 */
async function runInteractive(
  args: CliArgs,
  ask: AskInteractiveFn,
): Promise<number> {
  intro("create-oke");

  const answers = await ask({ name: args.name });
  if (answers === null) {
    cancel("Cancelled.");
    return 1;
  }

  return runScaffold({
    ...scaffoldArgsFromAnswers(answers),
    interactive: true,
  });
}

/**
 * Scaffold with optional spinner / outro, cleaning up on failure or cancel.
 *
 * @param options - Scaffold inputs + interactive flag
 */
async function runScaffold(
  options: ScaffoldCallArgs & { readonly interactive: boolean },
): Promise<number> {
  const { name, targetDir, source, interactive } = options;
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
    const result = scaffold({ targetDir, name, source });
    if (spun) spun.stop("Scaffolded.");
    const message = nextStepsText(result);
    if (interactive) {
      outro(message.trim());
    } else {
      console.log(message);
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
