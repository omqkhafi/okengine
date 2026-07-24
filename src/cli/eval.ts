/**
 * `oke eval` — run prompt eval sets; fails CI on regression.
 */

import { resolve } from "node:path";
import {
  parseEvalJsonl,
  runPromptEvals,
  type EvalCase,
} from "../elements/ai/eval.ts";
import type { Manifest } from "../manifest/types.ts";

/** Options for {@link runOkeEval}. */
export interface OkeEvalOptions {
  /** Manifest path (defaults to `./oke.manifest.json`). */
  readonly manifestPath?: string;
  /** Injected Manifest (tests). */
  readonly manifest?: Manifest;
  /**
   * Ask implementation for a prompt (tests / wired runtime).
   *
   * @param prompt - Prompt name
   * @param input - Case input
   */
  readonly ask?: (prompt: string, input: unknown) => Promise<unknown>;
  /** Load eval JSONL by relative path (defaults to Bun.file). */
  readonly loadEvals?: (path: string) => Promise<string>;
  /** Write stdout. */
  readonly write?: (text: string) => void;
}

/**
 * Run every prompt eval set declared in the Manifest.
 *
 * @param options - Manifest + ask wiring
 * @returns Exit code (1 on any failure)
 */
export async function runOkeEval(
  options: OkeEvalOptions = {},
): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  let manifest = options.manifest;
  if (!manifest) {
    const path = resolve(options.manifestPath ?? "oke.manifest.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.error(`oke eval: manifest not found: ${path}`);
      return 1;
    }
    manifest = (await file.json()) as Manifest;
  }

  const prompts = manifest.ai?.prompts ?? {};
  const names = Object.keys(prompts);
  if (names.length === 0) {
    write("oke eval: no prompts declared\n");
    return 0;
  }

  const load =
    options.loadEvals ??
    (async (p: string) => Bun.file(resolve(p)).text());

  let failed = 0;
  for (const name of names) {
    const prompt = prompts[name]!;
    if (!prompt.evals) {
      write(`oke eval: skip ${name} (no evals)\n`);
      continue;
    }
    if (!options.ask) {
      console.error(
        `oke eval: ask() not wired — provide a runtime binding for prompt "${name}"`,
      );
      return 1;
    }
    let cases: EvalCase[];
    try {
      cases = parseEvalJsonl(await load(prompt.evals));
    } catch (err) {
      console.error(
        `oke eval: failed to load ${prompt.evals}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return 1;
    }
    const suite = await runPromptEvals({
      prompt: name,
      version: prompt.version,
      cases,
      ask: (input) => options.ask!(name, input),
    });
    write(
      `oke eval: ${name}@${prompt.version ?? "?"} — ${suite.passed} passed, ${suite.failed} failed\n`,
    );
    if (!suite.ok) failed++;
  }
  return failed > 0 ? 1 : 0;
}

/**
 * CLI entry for `oke eval`.
 *
 * @param args - Remaining argv after `eval`
 */
export async function evalCli(args: string[]): Promise<number> {
  let manifestPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--manifest" || a === "-m") {
      manifestPath = args[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`oke eval [--manifest oke.manifest.json]

Run prompt eval sets declared in the Manifest. Fails CI on regression.
`);
      return 0;
    }
  }
  return runOkeEval({ manifestPath });
}
