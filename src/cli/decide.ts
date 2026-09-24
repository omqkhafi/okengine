/**
 * `oke decide promote` — fetch the operator candidate and write the lockfile.
 * The command does not recompute a certificate.
 */

import { resolve } from "node:path";
import {
  DECISION_LOCK_FILENAME,
  lockFromCandidate,
  parseDecisionLockfile,
  type DecisionLockfile,
} from "../elements/ai/decisions/certificate.ts";

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
  const path = resolve(options.lockPath ?? DECISION_LOCK_FILENAME);
  let current = options.current;
  if (!current) {
    const file = Bun.file(path);
    if (await file.exists()) current = parseDecisionLockfile(await file.json());
  }
  const next = lockFromCandidate(options.name, candidate, current);
  await Bun.write(path, `${JSON.stringify(next, null, 2)}\n`);
  return next;
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

Fetch the operator candidate and write oke-decisions.lock.json next to the app config.
`);
    return sub ? 0 : 1;
  }
  if (sub !== "promote" || !name) {
    console.error("oke decide: expected `oke decide promote <name>`");
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
