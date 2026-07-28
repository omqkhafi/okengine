/**
 * `create-oke` CLI — clean templates by default; teaching examples opt-in.
 *
 * ```bash
 * bunx create-oke@latest <name> [--template hello|minimal|standard|full]
 * bunx create-oke@latest <name> --from-example notes|linkly|provisions|skyport
 * bunx create-oke@latest <name> --yes
 * bunx create-oke@latest   # interactive when stdin is a TTY
 * ```
 */

import {
  cancel,
  confirm,
  intro,
  isCancel,
  note,
  outro,
  select,
  spinner,
  text,
} from "@clack/prompts";
import { basename, relative, resolve } from "node:path";
import { existsSync, rmSync } from "node:fs";
import { agentsMdContent } from "./agents-md.ts";
import { docsUrl } from "./docs-origin.ts";
import { scaffold, type ScaffoldResult, type ScaffoldSource } from "./scaffold.ts";
import {
  DEFAULT_TEMPLATE,
  EXAMPLE_NEW_IDEAS,
  EXAMPLES,
  TEMPLATE_PURPOSES,
  TEMPLATES,
  isExampleId,
  isTemplateId,
  resolveLocalOkengineRoot,
  type ExampleId,
  type TemplateId,
} from "./templates.ts";
import { shouldBunLinkLocalOkengine, type SqlDriverId, DEFAULT_SQL_DRIVER, isSqlDriverId, SQL_DRIVERS } from "./transform.ts";

/** Parsed CLI arguments. */
export type CliArgs = {
  readonly name: string | undefined;
  readonly template: TemplateId;
  readonly fromExample: ExampleId | undefined;
  /** True when `--template` / `-t` was present on the argv. */
  readonly templateExplicit: boolean;
  /** Store SQL driver (`sqlite` default). */
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
      readonly sqlDriver: SqlDriverId;
      readonly installAndRun: boolean;
      readonly agentsMd: boolean;
    }
  | {
      readonly name: string;
      readonly choice: typeof FROM_EXAMPLE_CHOICE;
      readonly example: ExampleId;
      readonly sqlDriver: SqlDriverId;
      readonly installAndRun: boolean;
      readonly agentsMd: boolean;
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
  let sqlDriver: SqlDriverId = DEFAULT_SQL_DRIVER;
  let sqlDriverExplicit = false;
  let help = false;
  let yes = false;
  let install: boolean | undefined;
  let agentsMd = true;
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
    if (a === "--sql") {
      const next = argv[++i];
      if (!next || !isSqlDriverId(next)) {
        throw new Error(
          `create-oke: --sql must be one of ${SQL_DRIVERS.join("|")}`,
        );
      }
      sqlDriver = next;
      sqlDriverExplicit = true;
      continue;
    }
    if (a.startsWith("--sql=")) {
      const value = a.slice("--sql=".length);
      if (!isSqlDriverId(value)) {
        throw new Error(
          `create-oke: --sql must be one of ${SQL_DRIVERS.join("|")}`,
        );
      }
      sqlDriver = value;
      sqlDriverExplicit = true;
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

  if (argv.includes("--install") && argv.includes("--no-install")) {
    throw new Error("create-oke: use either --install or --no-install, not both");
  }

  if (name !== undefined) {
    targetDir = resolve(name);
  }

  return {
    name,
    template,
    fromExample,
    templateExplicit,
    sqlDriver,
    sqlDriverExplicit,
    help,
    yes,
    install,
    agentsMd,
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
 * @param options - Whether a local `bun link okengine` step applies
 */
export function nextStepsText(
  result: ScaffoldResult,
  options: { readonly bunLinkOkengine?: boolean } = {},
): string {
  const linkLine = options.bunLinkOkengine
    ? "\n  bun link okengine   # use your local okengine (after `bun link` in the repo)"
    : "";
  return `
Scaffolded ${result.label} → ${result.targetDir}

Next steps:

  cd ${formatCdPath(result.targetDir)}
  bun install${linkLine}
  oke dev          # app :6530 · Console :6533 · MCP :6535

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
  const exampleLines = EXAMPLES.map(
    (id) => `  ${id.padEnd(12)}${EXAMPLE_NEW_IDEAS[id]}`,
  ).join("\n");

  return `create-oke — scaffold an okengine app

Usage:
  bunx create-oke@latest <name> [--template hello|minimal|standard|full]
  bunx create-oke@latest <name> --from-example notes|linkly|provisions|skyport
  bunx create-oke@latest <name> --yes
  bunx create-oke@latest          # interactive (TTY only)

Options:
  -t, --template <id>   Clean starter (default: ${DEFAULT_TEMPLATE})
  --from-example <id>   Teaching example (non-interactive)
  --sql <id>            Store SQL driver: ${SQL_DRIVERS.join("|")} (default: ${DEFAULT_SQL_DRIVER})
                        postgres → pgTable + pin store.sql; sqlite → sqliteTable
                        (keeps dual-mode local/docker/prod pins)
  -y, --yes             No prompts; defaults + bun install (no oke dev)
  --install             Run bun install after scaffold
  --no-install          Skip bun install
  --agents-md           Write AGENTS.md (default)
  --no-agents-md        Skip AGENTS.md
  -h, --help            Show this help

Templates (clean starters from templates/):
${templateLines}

--from-example (copies a teaching example, including its business logic and
comments — most new projects want --template instead):
${exampleLines}

No telemetry. Bun only. On a TTY, a project name alone still opens the wizard
(confirm name, template, SQL driver, install). Non-TTY / --yes / --template /
--from-example stay fully scriptable.
`;
}

/**
 * Whether the CLI should open the interactive Clack flow.
 *
 * TTY humans get the wizard even when a name is pre-filled. Config flags
 * (`--template`, `--from-example`) or `--yes` skip prompts for CI/agents.
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
  if (args.yes) return false;
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
    agentsMd: args.agentsMd,
    sqlDriver: args.sqlDriver,
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
      agentsMd: answers.agentsMd,
      sqlDriver: answers.sqlDriver,
    };
  }
  return {
    name,
    targetDir,
    source: { kind: "template", id: answers.choice },
    agentsMd: answers.agentsMd,
    sqlDriver: answers.sqlDriver,
  };
}

/**
 * Ask step — clack prompts only. Returns answers or `null` on cancel.
 *
 * Injectable for tests; production uses {@link askInteractiveAnswers}.
 *
 * @param partial - Name already known (pre-filled in the prompt)
 */
export type AskInteractiveFn = (
  partial: { readonly name?: string; readonly agentsMd?: boolean },
) => Promise<InteractiveAnswers | null>;

/**
 * Collect interactive answers via `@clack/prompts`.
 *
 * @param partial - Optional pre-filled project name / agents-md default
 * @returns Answers, or `null` if the user cancelled
 */
export async function askInteractiveAnswers(
  partial: { readonly name?: string; readonly agentsMd?: boolean } = {},
): Promise<InteractiveAnswers | null> {
  const nameValue = await text({
    message: "Project name",
    placeholder: "my-app",
    initialValue: partial.name ?? "my-app",
    validate: (value) => {
      if (!value?.trim()) return "Project name is required";
      return undefined;
    },
  });
  if (isCancel(nameValue)) return null;
  const name = String(nameValue).trim();

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

  const agentsMd = partial.agentsMd ?? true;

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

    const sqlDriver = await askSqlDriver();
    if (sqlDriver === null) return null;

    const installAndRunValue = await confirm({
      message: "Install dependencies and start oke dev?",
      initialValue: true,
    });
    if (isCancel(installAndRunValue)) return null;

    return {
      name,
      choice: FROM_EXAMPLE_CHOICE,
      example: exampleValue as ExampleId,
      sqlDriver,
      installAndRun: Boolean(installAndRunValue),
      agentsMd,
    };
  }

  const templateId = templateValue as TemplateId;
  // hello has no Store — skip the SQL prompt.
  const sqlDriver =
    templateId === "hello" ? DEFAULT_SQL_DRIVER : await askSqlDriver();
  if (sqlDriver === null) return null;

  const installAndRunValue = await confirm({
    message: "Install dependencies and start oke dev?",
    initialValue: true,
  });
  if (isCancel(installAndRunValue)) return null;

  return {
    name,
    choice: templateId,
    sqlDriver,
    installAndRun: Boolean(installAndRunValue),
    agentsMd,
  };
}

/**
 * Ask which store.sql driver to pin (schema dialect + config).
 *
 * @returns Chosen driver, or `null` on cancel
 */
async function askSqlDriver(): Promise<SqlDriverId | null> {
  const value = await select({
    message: "Store SQL driver",
    options: [
      {
        value: "sqlite" as const,
        label: "sqlite",
        hint: "File DB — fastest local start",
      },
      {
        value: "postgres" as const,
        label: "postgres",
        hint: "pgTable schema · same dialect for local/docker/prod",
      },
    ],
    initialValue: DEFAULT_SQL_DRIVER,
  });
  if (isCancel(value)) return null;
  return value as SqlDriverId;
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
 * @param options - Test seams (stdin TTY, ask injection, skip real install/dev)
 * @returns Exit code
 */
export async function run(
  argv: readonly string[],
  options: {
    readonly stdinIsTTY?: boolean | undefined;
    readonly ask?: AskInteractiveFn;
    /** When false, skip spawning bun install / oke dev (tests). Default true. */
    readonly runPostScaffold?: boolean;
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
    return runInteractive(args, options.ask ?? askInteractiveAnswers, options);
  }

  if (args.name === undefined) {
    console.log(helpText());
    console.error(
      "create-oke: missing <name>. Pass a name, or run in a TTY for the wizard.",
    );
    console.error("  Example: bunx create-oke@latest my-app --yes");
    return 1;
  }

  if (args.yes) {
    const source = sourceFromArgs(args);
    console.log(
      `Using defaults: ${source.kind}=${source.id} sql=${args.sqlDriver} agents-md=${args.agentsMd} install=${shouldInstall(args)}`,
    );
  }

  return runScaffold({
    ...scaffoldArgsFromCli(args),
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

  const answers = await ask({ name: args.name, agentsMd: args.agentsMd });
  if (answers === null) {
    cancel("Cancelled.");
    return 1;
  }

  return runScaffold({
    ...scaffoldArgsFromAnswers(answers),
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
    const result = scaffold({
      targetDir,
      name,
      source,
      writeAgentsMd: agentsMd,
      sqlDriver,
    });
    if (spun) spun.stop("Scaffolded.");

    const localRoot = resolveLocalOkengineRoot();
    const bunLinkOkengine = shouldBunLinkLocalOkengine(
      result.okengineDependency,
      localRoot,
    );

    if (runPostScaffold && install) {
      // Interactive: inherit stdio so progress is visible (a spinner + piped
      // bun install can look "stuck" and historically deadlocked on full pipes).
      if (interactive) {
        console.log("Installing dependencies…");
        const installOk = await runCommand(["bun", "install"], targetDir, {
          inherit: true,
        });
        if (!installOk) {
          cleanup();
          console.error("create-oke: bun install failed");
          return 1;
        }
      } else {
        const installOk = await runCommand(["bun", "install"], targetDir);
        if (!installOk) {
          cleanup();
          console.error("create-oke: bun install failed");
          return 1;
        }
      }

      // After a fast registry install, swap in the globally `bun link`ed
      // okengine so unreleased local/docker UX is what `oke dev` runs.
      if (bunLinkOkengine) {
        if (interactive) console.log("Linking local okengine…");
        const linkOk = await runCommand(["bun", "link", "okengine"], targetDir, {
          inherit: interactive,
        });
        if (!linkOk) {
          console.warn(
            "create-oke: bun link okengine failed — in the okengine repo run: bun link",
          );
        } else if (interactive) {
          console.log("Linked local okengine.");
        }
      }
    }

    const message = nextStepsText(result, { bunLinkOkengine });
    if (interactive) {
      note(
        [
          `App      http://127.0.0.1:6530`,
          `Console  http://127.0.0.1:6533`,
          `MCP      http://127.0.0.1:6535`,
          `Docs     ${docsUrl("/docs")}`,
          agentsMd ? `Agents   AGENTS.md` : undefined,
          bunLinkOkengine ? `Local    okengine via bun link` : undefined,
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
 * When stdio is piped, stdout/stderr are drained concurrently — otherwise a
 * chatty child (e.g. `bun install`) can fill the pipe buffer and deadlock.
 *
 * @param cmd - Argv
 * @param cwd - Working directory
 * @param options - Inherit stdio for long-running / interactive processes
 */
async function runCommand(
  cmd: readonly string[],
  cwd: string,
  options: { readonly inherit?: boolean } = {},
): Promise<boolean> {
  const inherit = options.inherit === true;
  const proc = Bun.spawn([...cmd], {
    cwd,
    stdout: inherit ? "inherit" : "pipe",
    stderr: inherit ? "inherit" : "pipe",
    stdin: inherit ? "inherit" : undefined,
  });
  if (inherit) {
    return (await proc.exited) === 0;
  }
  const stdout = proc.stdout;
  const stderr = proc.stderr;
  const [, errText, code] = await Promise.all([
    stdout ? new Response(stdout).text() : Promise.resolve(""),
    stderr ? new Response(stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);
  if (code !== 0 && errText.trim()) console.error(errText);
  return code === 0;
}

/** Re-export for tests that assert agents content shape. */
export { agentsMdContent };
