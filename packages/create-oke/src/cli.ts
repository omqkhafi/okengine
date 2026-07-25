/**
 * `create-oke` CLI — one command, sensible default, done.
 *
 * ```bash
 * bunx create-oke@latest <name> [--template notes|linkly|provisions|skyport]
 * ```
 */

import { basename, relative, resolve } from "node:path";
import { scaffold } from "./scaffold.ts";
import {
  DEFAULT_TEMPLATE,
  TEMPLATES,
  isTemplateId,
  type TemplateId,
} from "./templates.ts";

/** Parsed CLI arguments. */
export type CliArgs = {
  readonly name: string | undefined;
  readonly template: TemplateId;
  readonly help: boolean;
  readonly targetDir: string | undefined;
};

/**
 * Parse argv after the binary name.
 *
 * @param argv - Process arguments (no node/bun binary)
 */
export function parseArgs(argv: readonly string[]): CliArgs {
  let name: string | undefined;
  let template: TemplateId = DEFAULT_TEMPLATE;
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

  if (name !== undefined) {
    targetDir = resolve(name);
  }

  return { name, template, help, targetDir };
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
 * Help text — next steps match four-applications.md (`bun install` · `oke dev`).
 */
export function helpText(): string {
  return `create-oke — scaffold an okengine app

Usage:
  bunx create-oke@latest <name> [--template notes|linkly|provisions|skyport]

Templates (from examples/):
  notes        basic — Flow · Store                         (default)
  linkly       intermediate — + Signal · Clock · Gate
  provisions   advanced — + Vault · Channel · plugins
  skyport      complex — all eight elements · AI · tenancy

No telemetry. Bun only. No interactive wizard.
`;
}

/**
 * Run the CLI.
 *
 * @param argv - Args after the binary
 * @returns Exit code
 */
export async function run(argv: readonly string[]): Promise<number> {
  let args: CliArgs;
  try {
    args = parseArgs(argv);
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }

  if (args.help || args.name === undefined) {
    console.log(helpText());
    if (args.name === undefined && !args.help) {
      console.error("create-oke: missing <name>");
      return 1;
    }
    return args.help ? 0 : 1;
  }

  const projectName = basename(resolve(args.name));
  try {
    const result = scaffold({
      targetDir: args.targetDir!,
      name: projectName,
      template: args.template,
    });

    console.log(`
Scaffolded ${result.template} → ${result.targetDir}

Next steps:

  cd ${formatCdPath(result.targetDir)}
  bun install
  oke dev          # app :6530 · Console :6533 · MCP :6535
`);
    return 0;
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    return 1;
  }
}
