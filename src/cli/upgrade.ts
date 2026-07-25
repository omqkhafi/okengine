/**
 * `oke upgrade` — run codemods for a breaking change, print the diff.
 */

import {
  runCodemods,
  type CodemodChange,
} from "../upgrade/codemods.ts";

/** One file rewrite produced by a codemod. */
export type UpgradeChange = CodemodChange;

/** Options for {@link runUpgrade}. */
export interface UpgradeOptions {
  readonly cwd?: string;
  readonly write?: (text: string) => void;
  /** Apply without writing (print diff only). Default true for safety. */
  readonly dryRun?: boolean;
  /**
   * Codemod runner (tests / versioned transforms).
   *
   * @param cwd - Project root
   */
  readonly runCodemods?: (cwd: string) => Promise<readonly UpgradeChange[]>;
}

/**
 * Run upgrade codemods and print a unified-style diff.
 *
 * @param options - Cwd / dry-run
 */
export async function runUpgrade(options: UpgradeOptions = {}): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  const cwd = options.cwd ?? process.cwd();
  const dryRun = options.dryRun ?? true;
  const run = options.runCodemods ?? runCodemods;

  try {
    const changes = await run(cwd);
    if (changes.length === 0) {
      write("oke upgrade: no codemods to apply\n");
      return 0;
    }
    for (const c of changes) {
      write(`--- a/${c.path}\n+++ b/${c.path}\n`);
      write(unifiedDiff(c.before, c.after));
      if (!dryRun) await Bun.write(`${cwd}/${c.path}`, c.after);
    }
    write(
      dryRun
        ? `oke upgrade: ${changes.length} change(s) (dry-run — pass --apply to write)\n`
        : `oke upgrade: applied ${changes.length} change(s)\n`,
    );
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * CLI entry for `oke upgrade`.
 *
 * @param args - Args after `upgrade`
 */
export async function upgradeCli(args: readonly string[]): Promise<number> {
  let dryRun = true;
  for (const a of args) {
    if (a === "--apply" || a === "-a") dryRun = false;
    else if (a === "--help" || a === "-h") {
      console.log(`oke upgrade [--apply|-a]

Run codemods for a breaking change and print the diff.
Pass --apply to write files (default is dry-run — never writes without it).
Codemods ship with every breaking change (unified-theory §22).
`);
      return 0;
    }
  }
  return runUpgrade({ dryRun });
}

/**
 * Minimal unified diff for short files.
 *
 * @param before - Original
 * @param after - Rewritten
 */
export function unifiedDiff(before: string, after: string): string {
  const a = before.split("\n");
  const b = after.split("\n");
  const lines: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    const left = a[i];
    const right = b[i];
    if (left === right) {
      if (left !== undefined) lines.push(` ${left}`);
    } else {
      if (left !== undefined) lines.push(`-${left}`);
      if (right !== undefined) lines.push(`+${right}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
