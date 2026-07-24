/**
 * `oke gates list` — print every Module:Action pair derived from the Manifest.
 */

import { resolve } from "node:path";
import {
  deriveModuleActions,
  formatGatesList,
} from "../elements/gate/permissions.ts";
import type { Manifest } from "../manifest/types.ts";

/** Options for {@link gatesList}. */
export interface GatesListOptions {
  /** Path to a Manifest JSON file (defaults to `./oke.manifest.json`). */
  readonly manifestPath?: string;
  /** Injected Manifest (tests). */
  readonly manifest?: Manifest;
  /** Write stdout (defaults to console.log). */
  readonly write?: (text: string) => void;
}

/**
 * List every Module:Action pair.
 *
 * @param options - Manifest source
 * @returns Exit code
 */
export async function gatesList(options: GatesListOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  let manifest = options.manifest;
  if (!manifest) {
    const path = resolve(options.manifestPath ?? "oke.manifest.json");
    const file = Bun.file(path);
    if (!(await file.exists())) {
      console.error(`oke gates list: manifest not found: ${path}`);
      return 1;
    }
    manifest = (await file.json()) as Manifest;
  }
  const pairs = deriveModuleActions(manifest);
  write(formatGatesList(pairs));
  return 0;
}

/**
 * CLI entry for `oke gates list`.
 *
 * @param args - Remaining argv after `gates list`
 */
export async function gatesListCli(args: string[]): Promise<number> {
  let manifestPath: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--manifest" || a === "-m") {
      manifestPath = args[++i];
    } else if (a === "--help" || a === "-h") {
      console.log(`oke gates list [--manifest oke.manifest.json]

Print every Module:Action pair derived from the Manifest.
`);
      return 0;
    }
  }
  return gatesList({ manifestPath });
}
