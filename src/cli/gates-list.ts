/**
 * `oke gates list` — print every Module:Action pair derived from the Manifest.
 */

import { resolve } from "node:path";
import {
  deriveModuleActions,
  formatGatesList,
} from "../elements/gate/permissions.ts";
import type { Manifest } from "../manifest/types.ts";
import { wantsJson } from "./args.ts";
import { EXIT_OK, EXIT_RUNTIME } from "./exit.ts";

/** Options for {@link gatesList}. */
export interface GatesListOptions {
  /** Path to a Manifest JSON file (defaults to `./oke.manifest.json`). */
  readonly manifestPath?: string;
  /** Injected Manifest (tests). */
  readonly manifest?: Manifest;
  /** Write stdout (defaults to console.log). */
  readonly write?: (text: string) => void;
  /** Write hints / errors (defaults to stderr). */
  readonly writeErr?: (text: string) => void;
  /** Emit only JSON on stdout. */
  readonly json?: boolean;
}

/**
 * List every Module:Action pair.
 *
 * @param options - Manifest source
 * @returns Exit code
 */
export async function gatesList(options: GatesListOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const writeErr = options.writeErr ?? ((t) => process.stderr.write(t));
  const json = options.json ?? false;
  let manifest = options.manifest;
  if (!manifest) {
    const path = resolve(options.manifestPath ?? "oke.manifest.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
      const msg = `oke gates list: manifest not found: ${path}`;
      if (json) {
        write(`${JSON.stringify({ ok: false, error: msg }, null, 2)}\n`);
      } else {
        writeErr(`${msg}\n`);
      }
      return EXIT_RUNTIME;
    }
    manifest = (await file.json()) as Manifest;
  }
  const gates = deriveModuleActions(manifest);
  if (json) {
    write(`${JSON.stringify({ ok: true, gates }, null, 2)}\n`);
    return EXIT_OK;
  }
  write(formatGatesList(gates));
  return EXIT_OK;
}

/**
 * CLI entry for `oke gates list`.
 *
 * @param args - Remaining argv after `gates list`
 */
export async function gatesListCli(args: string[]): Promise<number> {
  let manifestPath: string | undefined;
  const json = wantsJson(args);
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--manifest" || a === "-m") {
      manifestPath = args[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`oke gates list [--manifest|-m oke.manifest.json] [--json|-j]

Print every Module:Action pair derived from the Manifest.
--json  Machine-parseable JSON on stdout; hints on stderr.
`);
      return EXIT_OK;
    }
  }
  return gatesList({ manifestPath, json });
}
