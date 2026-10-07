/**
 * `oke decide promote` — fetch the operator candidate and write the lockfile.
 * The command does not recompute a certificate.
 */

import { join, resolve } from "node:path";
import {
  DECISION_LOCK_FILENAME,
  lockFromCandidate,
  parseDecisionLockfile,
  type DecisionLockfile,
} from "../elements/ai/decisions/certificate.ts";
import { DECISION_EXPORT_WARNING } from "../elements/ai/decisions/export.ts";
import { ALIAS_CERTIFICATE_MS } from "../elements/ai/deciders/presets.ts";
import { requiredDatedModel } from "../elements/ai/decisions/catalog.ts";
import type { Manifest } from "../manifest/types.ts";
import type { DecisionEvaluate } from "../elements/ai/decisions/certify.ts";

/** Options for {@link promoteDecision}. */
export interface PromoteDecisionOptions {
  readonly name: string;
  /** Origin of the running app, including scheme and port. */
  readonly origin: string;
  /** Lockfile path. Defaults to `oke-decisions.lock.json` in the app root. */
  readonly lockPath?: string;
  /** Operator credential header value (`Authorization`). */
  readonly authorization?: string;
  /** Injected fetch. Defaults to the global fetch. */
  readonly fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Existing lockfile body. When omitted, the file is read if it exists. */
  readonly current?: DecisionLockfile;
}

/**
 * Fetch one candidate and write it into the app lockfile.
 *
 * @param options - Decision name, origin, and credentials
 */
export async function promoteDecision(options: PromoteDecisionOptions): Promise<DecisionLockfile> {
  const fetcher = options.fetcher ?? fetch;
  const url = `${options.origin.replace(/\/$/, "")}/_oke/decisions/${encodeURIComponent(options.name)}/candidate`;
  const headers = new Headers();
  if (options.authorization) headers.set("authorization", options.authorization);
  const res = await fetcher(url, { headers });
  if (!res.ok) {
    throw new Error(`oke decide promote: ${res.status} from ${url}`);
  }
  const candidate: unknown = await res.json();
  const root = resolve(process.env["OKE_ROOT_DIR"] ?? ".");
  const path = resolve(options.lockPath ?? join(root, DECISION_LOCK_FILENAME));
  let current = options.current;
  if (!current) {
    const file = Bun.file(path);
    if (await file.exists()) current = parseDecisionLockfile(await file.json());
  }
  const next = lockFromCandidate(options.name, candidate, current);
  const { persistDecisionDrift } = await import("../elements/ai/decisions/labels.ts");
  persistDecisionDrift(options.name, false);
  await Bun.write(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
}

/** Options for {@link exportDecisionLabelsFile}. */
export interface ExportDecisionLabelsOptions {
  readonly name: string;
  /** Origin of the running app, including scheme and port. */
  readonly origin: string;
  /** File the JSONL is written to. */
  readonly out: string;
  /** Operator credential header value (`Authorization`). */
  readonly authorization?: string;
  /** Tenant the operator is exporting. A mismatch is rejected by the app. */
  readonly tenant?: string;
  /** Injected fetch. Defaults to the global fetch. */
  readonly fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  /** Where the production-data warning is printed. Defaults to stdout. */
  readonly write?: (text: string) => void;
}

/**
 * Fetch reviewed labels and write seed JSONL. Prints that the file holds production data.
 *
 * @param options - Decision name, origin, and output path
 */
export async function exportDecisionLabelsFile(
  options: ExportDecisionLabelsOptions,
): Promise<void> {
  const fetcher = options.fetcher ?? fetch;
  const url = new URL(
    `/_oke/decisions/${encodeURIComponent(options.name)}/labels`,
    options.origin.endsWith("/") ? options.origin : `${options.origin}/`,
  );
  if (options.tenant) url.searchParams.set("tenant", options.tenant);
  const headers = new Headers();
  if (options.authorization) headers.set("authorization", options.authorization);
  const res = await fetcher(url.toString(), { headers });
  if (!res.ok) {
    throw new Error(`oke decide labels: ${res.status} from ${url}`);
  }
  const body = (await res.json()) as { lines?: string; data?: { lines?: string } };
  const lines = body.data?.lines ?? body.lines ?? "";
  const write = options.write ?? ((text: string) => process.stdout.write(text));
  write(`${DECISION_EXPORT_WARNING}\n`);
  await Bun.write(options.out, lines);
}

/**
 * `oke decide labels <name> --export`.
 *
 * @param name - Decision name
 * @param rest - Flags after the name
 */
async function exportLabelsCommand(name: string | undefined, rest: string[]): Promise<number> {
  if (!name || !rest.includes("--export")) {
    console.error("oke decide: expected `oke decide labels <name> --export`");
    return 1;
  }
  let origin = process.env.OKE_ORIGIN ?? "http://127.0.0.1:6530";
  let out = `${name}.labels.jsonl`;
  let authorization = process.env.OKE_OPERATOR_AUTHORIZATION;
  let tenant: string | undefined;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--origin") origin = rest[++i] ?? origin;
    else if (arg === "--out") out = rest[++i] ?? out;
    else if (arg === "--authorization") authorization = rest[++i];
    else if (arg === "--tenant") tenant = rest[++i];
  }
  await exportDecisionLabelsFile({
    name,
    origin,
    out,
    ...(authorization !== undefined ? { authorization } : {}),
    ...(tenant !== undefined ? { tenant } : {}),
  });
  return 0;
}

/**
 * CLI entry for `oke decide`.
 *
 * @param args - Remaining argv after `decide`
 */
/**
 * Certify one decision for each named decider and write lockfile version 2.
 *
 * @param options - Decision, deciders, and injected evaluators
 */
export async function certifyDecisionDeciders(options: {
  readonly root: string;
  readonly manifest: Manifest;
  readonly decision: string;
  readonly deciders: readonly string[];
  readonly evaluate: Readonly<Record<string, DecisionEvaluate>>;
  readonly now?: () => number;
  readonly fetcher?: (input: string, init?: RequestInit) => Promise<Response>;
  readonly write?: (text: string) => void;
}): Promise<DecisionLockfile> {
  const { certifySeed } = await import("../elements/ai/decisions/certify.ts");
  const { aiDecisionRegistry, aiDeciderRegistry } = await import("../kernel/element-registries.ts");
  const decl = aiDecisionRegistry.find((item) => item.name === options.decision);
  const decision = options.manifest.ai?.decisions?.[options.decision];
  if (!decl || !decision) {
    throw new Error(`oke decide certify: decision "${options.decision}" is not loaded`);
  }
  if (!decision.evals) {
    throw new Error(`oke decide certify: decision "${options.decision}" has no evals`);
  }
  const text = await Bun.file(resolve(options.root, decision.evals)).text();
  const lockPath = resolve(options.root, DECISION_LOCK_FILENAME);
  const existing = Bun.file(lockPath);
  let current: DecisionLockfile | undefined;
  if (await existing.exists()) current = parseDecisionLockfile(await existing.json());
  const write = options.write ?? ((line: string) => process.stdout.write(line));
  const deciders: Record<string, DecisionLockfile["decisions"][string]["deciders"][string]> = {
    ...(current?.decisions[options.decision]?.deciders ?? {}),
  };
  for (const name of options.deciders) {
    const decider = aiDeciderRegistry.find((item) => item.name === name) ?? undefined;
    const manifestDecider = options.manifest.ai?.deciders?.[name];
    if (!decider && !manifestDecider) {
      throw new Error(`oke decide certify: decider "${name}" is not loaded`);
    }
    const model = decider?.model ?? manifestDecider?.model ?? "";
    const pinning = decider?.pinning ?? manifestDecider?.pinning ?? "dated";
    const baseUrl = decider?.baseUrl ?? manifestDecider?.baseUrl ?? "";
    const required = await requiredDatedModel(model, baseUrl, pinning, options.fetcher);
    if (required && required !== model) {
      throw new Error(
        `oke decide certify: autonomy requires model "${required}" on decider "${name}"`,
      );
    }
    const evaluate = options.evaluate[name];
    if (!evaluate) throw new Error(`oke decide certify: no evaluator for decider "${name}"`);
    const alias = pinning === "alias";
    const now = options.now ?? Date.now;
    const result = await certifySeed({
      model,
      pinned: !alias,
      ...(alias ? { expiresAt: now() + ALIAS_CERTIFICATE_MS } : {}),
      maxError: decision.autonomy?.maxError ?? decl.autonomy?.maxError ?? 0.05,
      delta: decision.autonomy?.risk ?? decl.autonomy?.risk ?? 0.1,
      jsonl: text,
      ask: decl.ask,
      evaluate,
      now,
    });
    deciders[name] = result.cert;
    if (result.unpinned) {
      write(`oke decide certify: decider "${name}" model "${result.cert.model}" is unpinned\n`);
    }
    for (const [question, row] of Object.entries(result.report)) {
      write(
        `${name}\t${question}\taccuracy ${row.accuracy.toFixed(3)}\tECE ${row.ece.toFixed(3)}\tcoverage ${row.coverage.toFixed(3)}\tp50 ${row.p50Ms}ms\tp95 ${row.p95Ms}ms\tcost ${row.cost}\n`,
      );
    }
  }
  const next: DecisionLockfile = {
    version: 2,
    decisions: { ...(current?.decisions ?? {}), [options.decision]: { deciders } },
  };
  await Bun.write(lockPath, `${JSON.stringify(next, null, 2)}\n`);
  const { setDecisionDrift } = await import("../elements/ai/decisions/certificate.ts");
  const { persistDecisionDrift } = await import("../elements/ai/decisions/labels.ts");
  setDecisionDrift(options.decision, false);
  persistDecisionDrift(options.decision, false);
  return next;
}

export async function decideCli(args: string[]): Promise<number> {
  const [sub, name, ...rest] = args;
  if (sub === "--help" || sub === "-h" || !sub) {
    console.log(`oke decide promote <name> [--origin URL] [--lock path]
oke decide labels <name> --export [--out file] [--origin URL]
oke decide certify <name> --deciders a,b
oke decide models

promote fetches the operator candidate and writes oke-decisions.lock.json.
labels --export writes reviewed labels as seed JSONL. The file contains production data.
certify writes one certificate per decider. models lists decision models.
`);
    return sub ? 0 : 1;
  }
  if (sub === "labels") return exportLabelsCommand(name, rest);
  if (sub === "models") {
    const { fetchDecisionModels } = await import("../elements/ai/decisions/catalog.ts");
    process.stdout.write(await fetchDecisionModels());
    return 0;
  }
  if (sub === "certify") return certifyCommand(name, rest);
  if (sub !== "promote" || !name) {
    console.error("oke decide: expected promote, labels, certify, or models");
    return 1;
  }
  let origin = process.env.OKE_ORIGIN ?? "http://127.0.0.1:6530";
  let lockPath: string | undefined;
  let authorization = process.env.OKE_OPERATOR_AUTHORIZATION;
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--origin") origin = rest[++i] ?? origin;
    else if (arg === "--lock") lockPath = rest[++i];
    else if (arg === "--authorization") authorization = rest[++i];
  }
  await promoteDecision({
    name,
    origin,
    ...(lockPath !== undefined ? { lockPath } : {}),
    ...(authorization !== undefined ? { authorization } : {}),
  });
  return 0;
}

async function certifyCommand(name: string | undefined, rest: string[]): Promise<number> {
  if (!name) {
    console.error("oke decide: expected `oke decide certify <name> --deciders a,b`");
    return 1;
  }
  const flag = rest.indexOf("--deciders");
  const list = flag >= 0 ? rest[flag + 1] : undefined;
  if (!list) {
    console.error("oke decide certify: --deciders is required");
    return 1;
  }
  const deciders = list
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const { resolveStartEntry } = await import("./start.ts");
  const root = resolve(process.env["OKE_ROOT_DIR"] ?? ".");
  try {
    await import(await resolveStartEntry(root));
  } catch (error) {
    console.error(
      `oke decide certify: failed to load the app: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  }
  const manifestPath = resolve(root, "oke.manifest.json");
  const file = Bun.file(manifestPath);
  if (!(await file.exists())) {
    console.error(`oke decide certify: manifest not found: ${manifestPath}`);
    return 1;
  }
  const manifest = (await file.json()) as Manifest;
  const { aiDeciderRegistry, aiDecisionRegistry } = await import("../kernel/element-registries.ts");
  const decl = aiDecisionRegistry.find((item) => item.name === name);
  if (!decl) {
    console.error(`oke decide certify: decision "${name}" is not loaded`);
    return 1;
  }
  const evaluate: Record<string, DecisionEvaluate> = {};
  for (const id of deciders) {
    const decider = aiDeciderRegistry.find((item) => item.name === id);
    if (!decider) {
      console.error(`oke decide certify: decider "${id}" is not loaded`);
      return 1;
    }
    const apiKey = process.env[decider.secret];
    if (!apiKey) {
      console.error(`oke decide certify: secret "${decider.secret}" is not configured`);
      return 1;
    }
    evaluate[id] = async (input) => {
      const { decisionHttp } = await import("../elements/ai/decisions/http.ts");
      const { encodeDecisionRequest, normalizeDecisionResponse, wireQuestions } =
        await import("../elements/ai/decisions/codec.ts");
      const request = { model: decider.model, state: input, questions: wireQuestions(decl.ask) };
      const raw = await decisionHttp({
        url: decider.baseUrl,
        apiKey,
        request,
        body: encodeDecisionRequest(decider.protocol, request),
        timeoutMs: 30_000,
        breakerKey: decider.name,
      });
      return normalizeDecisionResponse(decider.protocol, raw);
    };
  }
  await certifyDecisionDeciders({ root, manifest, decision: name, deciders, evaluate });
  return 0;
}
