/**
 * `oke docker clean` — remove leftover `oke-dev-*` compose stacks.
 */

import { cancel, confirm, intro, isCancel, multiselect, outro } from "@clack/prompts";
import {
  composeProjectName,
  defaultDockerRunner,
  downStack,
  isOkeProjectRoot,
  listOkeComposeProjects,
  resolveSelection,
  selectionKey,
  type DockerRunner,
  type OkeStack,
} from "../docker/cleanup.ts";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "./exit.ts";

/** Parsed flags for {@link runDockerClean}. */
export interface DockerCleanFlags {
  readonly yes?: boolean;
  readonly all?: boolean;
}

/** Options for {@link runDockerClean} (injectable for tests). */
export interface DockerCleanOptions extends DockerCleanFlags {
  readonly cwd?: string;
  readonly stdinIsTTY?: boolean;
  readonly runDocker?: DockerRunner;
  readonly write?: (text: string) => void;
  readonly writeErr?: (text: string) => void;
  /** Override interactive container pick (tests). `null` = cancel. */
  readonly pickKeys?: (
    stacks: readonly OkeStack[],
    scope: "current" | "other" | "all",
  ) => Promise<readonly string[] | null>;
  /** Override confirm (tests). */
  readonly confirmDown?: (projects: readonly string[]) => Promise<boolean>;
  /** When inside a project and other stacks exist — ask to include them. */
  readonly askIncludeOthers?: () => Promise<boolean | null>;
}

/**
 * Help text for `oke docker clean`.
 */
export function dockerCleanHelp(): string {
  return `oke docker clean [--yes|-y] [--all]

Remove leftover OKE docker compose stacks (containers, networks, volumes).

Selection is by compose project name (oke-dev-<id>) — never per-service.
Inside a project: focuses the current stack; optionally include others.
Outside a project: list every oke-dev-* stack and pick what to remove.

  --yes, -y   Non-interactive; required when stdin is not a TTY
  --all       With --yes outside a project: remove every oke-dev-* stack
`;
}

/**
 * Parse args after `docker clean`.
 *
 * @param args - Flag tokens
 */
export function parseDockerCleanArgs(args: readonly string[]): DockerCleanFlags & {
  readonly help?: boolean;
} {
  let yes = false;
  let all = false;
  for (const a of args) {
    if (a === "--help" || a === "-h") return { help: true };
    if (a === "--yes" || a === "-y") yes = true;
    else if (a === "--all") all = true;
    else if (a.startsWith("-")) {
      throw new Error(`oke docker clean: unknown flag ${a}`);
    } else {
      throw new Error(`oke docker clean: unexpected argument ${a}`);
    }
  }
  return { yes, all };
}

/**
 * Run stack cleanup.
 *
 * @param options - Flags + seams
 * @returns Exit code
 */
export async function runDockerClean(options: DockerCleanOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const writeErr = options.writeErr ?? ((t) => process.stderr.write(t));
  const cwd = options.cwd ?? process.cwd();
  const run = options.runDocker ?? defaultDockerRunner;
  const tty = options.stdinIsTTY ?? Boolean(process.stdin.isTTY);
  const yes = options.yes === true;
  const all = options.all === true;

  let stacks: readonly OkeStack[];
  try {
    stacks = await listOkeComposeProjects(run);
  } catch (err) {
    writeErr(`${err instanceof Error ? err.message : String(err)}\n`);
    return EXIT_RUNTIME;
  }

  const inside = await isOkeProjectRoot(cwd);
  const currentProject = inside ? composeProjectName(cwd) : null;

  if (stacks.length === 0) {
    write("oke docker clean: no oke-dev-* stacks found\n");
    return EXIT_OK;
  }

  if (!tty) {
    return runNonInteractive({
      stacks,
      inside,
      currentProject,
      yes,
      all,
      run,
      write,
      writeErr,
    });
  }

  return runInteractive({
    stacks,
    inside,
    currentProject,
    run,
    write,
    writeErr,
    pickKeys: options.pickKeys,
    confirmDown: options.confirmDown,
    askIncludeOthers: options.askIncludeOthers,
  });
}

/**
 * CLI entry for `oke docker clean …`.
 *
 * @param args - Args after `clean`
 */
export async function dockerCleanCli(args: readonly string[]): Promise<number> {
  let flags: ReturnType<typeof parseDockerCleanArgs>;
  try {
    flags = parseDockerCleanArgs(args);
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    console.error(dockerCleanHelp());
    return EXIT_USAGE;
  }
  if (flags.help) {
    console.log(dockerCleanHelp());
    return EXIT_OK;
  }
  return runDockerClean(flags);
}

async function runNonInteractive(options: {
  readonly stacks: readonly OkeStack[];
  readonly inside: boolean;
  readonly currentProject: string | null;
  readonly yes: boolean;
  readonly all: boolean;
  readonly run: DockerRunner;
  readonly write: (t: string) => void;
  readonly writeErr: (t: string) => void;
}): Promise<number> {
  const { stacks, inside, currentProject, yes, all, run, write, writeErr } = options;

  if (!yes) {
    writeErr("oke docker clean: non-TTY requires --yes (and --all when outside a project)\n");
    return EXIT_USAGE;
  }

  let projects: string[];
  if (inside && currentProject) {
    if (all) {
      projects = stacks.map((s) => s.project);
    } else {
      const hasCurrent = stacks.some((s) => s.project === currentProject);
      if (!hasCurrent) {
        write(`oke docker clean: no stack for this project (${currentProject})\n`);
        return EXIT_OK;
      }
      projects = [currentProject];
    }
  } else {
    if (!all) {
      writeErr(
        "oke docker clean: outside a project, pass --all --yes to remove every oke-dev-* stack\n",
      );
      return EXIT_USAGE;
    }
    projects = stacks.map((s) => s.project);
  }

  return tearDownProjects(projects, run, write, writeErr);
}

async function runInteractive(options: {
  readonly stacks: readonly OkeStack[];
  readonly inside: boolean;
  readonly currentProject: string | null;
  readonly run: DockerRunner;
  readonly write: (t: string) => void;
  readonly writeErr: (t: string) => void;
  readonly pickKeys?: DockerCleanOptions["pickKeys"];
  readonly confirmDown?: DockerCleanOptions["confirmDown"];
  readonly askIncludeOthers?: DockerCleanOptions["askIncludeOthers"];
}): Promise<number> {
  const {
    stacks,
    inside,
    currentProject,
    run,
    write,
    writeErr,
    pickKeys,
    confirmDown,
    askIncludeOthers,
  } = options;

  intro("oke docker clean");

  const selectedKeys: string[] = [];

  if (inside && currentProject) {
    const current = stacks.filter((s) => s.project === currentProject);
    const others = stacks.filter((s) => s.project !== currentProject);

    if (current.length === 0) {
      write(`No stack for this project (${currentProject}).\n`);
    } else {
      const keys = await pickProjectKeys({
        stacks: current,
        scope: "current",
        message: `Stack for this project (${currentProject})`,
        initialAll: true,
        pickKeys,
      });
      if (keys === null) {
        cancel("Cancelled.");
        return EXIT_OK;
      }
      selectedKeys.push(...keys);
    }

    if (others.length > 0) {
      const include = askIncludeOthers ? await askIncludeOthers() : await askIncludeOthersPrompt();
      if (include === null) {
        cancel("Cancelled.");
        return EXIT_OK;
      }
      if (include) {
        const keys = await pickProjectKeys({
          stacks: others,
          scope: "other",
          message: "Other OKE stacks on this machine",
          initialAll: false,
          pickKeys,
        });
        if (keys === null) {
          cancel("Cancelled.");
          return EXIT_OK;
        }
        selectedKeys.push(...keys);
      }
    }
  } else {
    const keys = await pickProjectKeys({
      stacks,
      scope: "all",
      message: "OKE docker stacks on this machine",
      initialAll: false,
      pickKeys,
    });
    if (keys === null) {
      cancel("Cancelled.");
      return EXIT_OK;
    }
    selectedKeys.push(...keys);
  }

  if (selectedKeys.length === 0) {
    outro("Nothing selected.");
    return EXIT_OK;
  }

  const { projects } = resolveSelection(selectedKeys, stacks);
  if (projects.length === 0) {
    outro("Nothing selected.");
    return EXIT_OK;
  }

  const summary = projects
    .map((p) => {
      const stack = stacks.find((s) => s.project === p);
      const n = stack?.containers.length ?? 0;
      return n === 0 ? `  ${p} (volumes/networks only)` : `  ${p} (${n} container(s))`;
    })
    .join("\n");

  const ok = confirmDown
    ? await confirmDown(projects)
    : await confirm({
        message: `Remove these stack(s) — containers, networks, and volumes?\n${summary}`,
        initialValue: false,
      });

  if (isCancel(ok) || ok === false) {
    cancel("Cancelled.");
    return EXIT_OK;
  }

  const code = await tearDownProjects(projects, run, write, writeErr);
  if (code === EXIT_OK) outro(`Removed ${projects.length} stack(s).`);
  return code;
}

async function askIncludeOthersPrompt(): Promise<boolean | null> {
  const value = await confirm({
    message: "Also clean other OKE stacks on this machine?",
    initialValue: false,
  });
  if (isCancel(value)) return null;
  return value;
}

/**
 * Multiselect compose projects (one row per `oke-dev-*` name).
 */
async function pickProjectKeys(options: {
  readonly stacks: readonly OkeStack[];
  readonly scope: "current" | "other" | "all";
  readonly message: string;
  readonly initialAll: boolean;
  readonly pickKeys?: DockerCleanOptions["pickKeys"];
}): Promise<readonly string[] | null> {
  const { stacks, scope, message, initialAll, pickKeys } = options;
  if (pickKeys) return pickKeys(stacks, scope);

  const entries = selectionEntries(stacks);
  if (entries.length === 0) return [];

  const value = await multiselect({
    message: `${message} — removes the whole stack (containers, networks, volumes)`,
    options: entries.map((e) => ({
      value: e.key,
      label: e.label,
      hint: e.hint,
    })),
    initialValues: initialAll ? entries.map((e) => e.key) : [],
    required: false,
  });
  if (isCancel(value)) return null;
  return value;
}

/**
 * One selectable row per compose project.
 *
 * @param stacks - Discovered stacks
 */
export function selectionEntries(stacks: readonly OkeStack[]): readonly {
  readonly key: string;
  readonly label: string;
  readonly hint?: string;
}[] {
  return stacks.map((stack) => {
    const n = stack.containers.length;
    return {
      key: selectionKey(stack.project),
      label: stack.project,
      hint:
        n === 0
          ? "no containers · volumes/networks may remain"
          : `${n} container${n === 1 ? "" : "s"}`,
    };
  });
}

async function tearDownProjects(
  projects: readonly string[],
  run: DockerRunner,
  write: (t: string) => void,
  writeErr: (t: string) => void,
): Promise<number> {
  for (const project of projects) {
    try {
      write(`oke docker clean: down -v ${project}\n`);
      await downStack(project, run);
    } catch (err) {
      writeErr(`${err instanceof Error ? err.message : String(err)}\n`);
      return EXIT_RUNTIME;
    }
  }
  return EXIT_OK;
}
