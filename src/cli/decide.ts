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
export async function decideCli(args: string[]): Promise<number> {
  const [sub, name, ...rest] = args;
  if (sub === "--help" || sub === "-h" || !sub) {
    console.log(`oke decide promote <name> [--origin URL] [--lock path]
oke decide labels <name> --export [--out file] [--origin URL]

promote fetches the operator candidate and writes oke-decisions.lock.json.
labels --export writes reviewed labels as seed JSONL. The file contains production data.
`);
    return sub ? 0 : 1;
  }
  if (sub === "labels") return exportLabelsCommand(name, rest);
  if (sub !== "promote" || !name) {
    console.error(
      "oke decide: expected `oke decide promote <name>` or `oke decide labels <name> --export`",
    );
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
