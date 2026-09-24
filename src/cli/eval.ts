/**
 * `oke eval` — run prompt eval sets; fails CI on regression.
 */

import { resolve } from "node:path";
import { parseEvalJsonl, runPromptEvals, type EvalCase } from "../elements/ai/eval.ts";
import type { DecisionResponse } from "../elements/ai/decisions/provider.ts";
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
export async function runOkeEval(options: OkeEvalOptions = {}): Promise<number> {
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

  const load = options.loadEvals ?? (async (p: string) => Bun.file(resolve(p)).text());

  let failed = 0;
  for (const name of names) {
    const prompt = prompts[name]!;
    if (!prompt.evals) {
      write(`oke eval: skip ${name} (no evals)\n`);
      continue;
    }
    if (!options.ask) {
      console.error(`oke eval: ask() not wired — provide a runtime binding for prompt "${name}"`);
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
  let certify = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--manifest" || a === "-m") {
      manifestPath = args[++i];
    } else if (a === "--certify") {
      certify = true;
    } else if (a === "--help" || a === "-h") {
      console.log(`oke eval [--manifest oke.manifest.json] [--certify]

Run prompt eval sets declared in the Manifest. Fails CI on regression.
--certify builds a decision certificate from each decision seed file.
`);
      return 0;
    }
  }
  if (certify) return runOkeCertify({ manifestPath });
  return runOkeEval({ manifestPath });
}

/**
 * Build certificates from decision seed files. Prompt evals are not run.
 *
 * @param options - Manifest path
 */
export async function runOkeCertify(
  options: {
    readonly manifestPath?: string;
    readonly manifest?: Manifest;
    readonly root?: string;
    readonly evaluate?: (input: unknown) => Promise<DecisionResponse>;
  } = {},
): Promise<number> {
  const { certifySeed } = await import("../elements/ai/decisions/certify.ts");
  const { aiDecisionRegistry } = await import("../kernel/element-registries.ts");
  const { DECISION_LOCK_FILENAME, parseDecisionLockfile } = await import(
    "../elements/ai/decisions/certificate.ts"
  );
  const { resolveStartEntry } = await import("./start.ts");
  const root = resolve(options.root ?? process.env["OKE_ROOT_DIR"] ?? ".");
  process.env["OKE_ROOT_DIR"] ??= root;
  let manifest = options.manifest;
  if (!manifest) {
    try {
      const entry = await resolveStartEntry(root);
      await import(entry);
    } catch (err) {
      console.error(
        `oke eval: failed to load the app: ${err instanceof Error ? err.message : String(err)}`,
      );
      return 1;
    }
    const path = resolve(root, options.manifestPath ?? "oke.manifest.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.error(`oke eval: manifest not found: ${path}`);
      return 1;
    }
    manifest = (await file.json()) as Manifest;
  }
  const decisions = manifest.ai?.decisions ?? {};
  const names = Object.keys(decisions);
  if (names.length === 0) {
    process.stdout.write("oke eval: no decisions declared\n");
    return 0;
  }
  const injected = options.evaluate;
  const lockPath = resolve(root, DECISION_LOCK_FILENAME);
  const existingFile = Bun.file(lockPath);
  const current = (await existingFile.exists())
    ? parseDecisionLockfile(await existingFile.json())
    : undefined;
  const next = { decisions: { ...(current?.decisions ?? {}) } };
  for (const name of names) {
    const decision = decisions[name];
    if (!decision?.evals) {
      process.stdout.write(`oke eval: skip ${name} (no evals)\n`);
      continue;
    }
    const decl = aiDecisionRegistry.find((item) => item.name === name);
    if (!decl) {
      console.error(`oke eval: decision "${name}" is not loaded`);
      return 1;
    }
    const text = await Bun.file(resolve(root, decision.evals)).text();
    const evaluate = injected ?? (await providerForDecision(decl));
    next.decisions[name] = await certifySeed({
      model: decl.model ?? decision.model ?? "",
      maxError: decision.autonomy?.maxError ?? 0.05,
      delta: decision.autonomy?.risk ?? decl.autonomy?.risk ?? 0.1,
      jsonl: text,
      ask: decl.ask,
      evaluate,
    });
    process.stdout.write(`${JSON.stringify({ [name]: next.decisions[name] })}\n`);
  }
  await Bun.write(lockPath, `${JSON.stringify(next, null, 2)}\n`);
  const { setDecisionDrift } = await import("../elements/ai/decisions/certificate.ts");
  const { persistDecisionDrift } = await import("../elements/ai/decisions/labels.ts");
  setDecisionDrift(false);
  persistDecisionDrift(false);
  return 0;
}

async function providerForDecision(
  decl: import("../elements/ai/declare.ts").AiDecisionDecl,
): Promise<(input: unknown) => Promise<DecisionResponse>> {
  const typesafe = decl.driverId === "typesafe";
  const keyName = typesafe ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY";
  const apiKey = process.env[keyName];
  if (!apiKey) throw new Error(`oke eval: secret "${keyName}" is not configured`);
  const { createTypesafeDecisionProvider, TYPESAFE_JEV_MODEL } = await import(
    "../elements/ai/decisions/typesafe.ts"
  );
  const { createOpenRouterDecisionProvider, OPENROUTER_JEV_MODEL } = await import(
    "../elements/ai/decisions/openrouter.ts"
  );
  const provider = typesafe
    ? createTypesafeDecisionProvider(apiKey)
    : createOpenRouterDecisionProvider(apiKey);
  const model = decl.model ?? (typesafe ? TYPESAFE_JEV_MODEL : OPENROUTER_JEV_MODEL);
  return (input) =>
    provider.evaluate({
      model,
      state: input,
      questions: wireFromDecl(decl),
    });
}

function wireFromDecl(
  decl: import("../elements/ai/declare.ts").AiDecisionDecl,
): import("../elements/ai/decisions/provider.ts").DecisionRequest["questions"] {
  const questions: Record<string, import("../elements/ai/decisions/provider.ts").WireQuestion> = {};
  for (const [id, question] of Object.entries(decl.ask)) {
    if (question.kind === "choice") {
      questions[id] = {
        type: "choice",
        instructions: question.instructions,
        criteria: { ...question.options, none_of_these: null },
      };
    } else if (question.kind === "score") {
      questions[id] = { type: "score", instructions: question.instructions, criteria: question.levels };
    } else {
      questions[id] = {
        type: "noul",
        instructions: question.instructions,
        ...(question.criteria !== undefined ? { criteria: question.criteria } : {}),
      };
    }
  }
  return questions;
}
