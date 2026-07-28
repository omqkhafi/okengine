/**
 * `oke mode` — get or set the saved `oke dev` infrastructure preference.
 */

import {
  parseDevMode,
  readDevMode,
  writeDevMode,
  type DevMode,
} from "./dev-mode.ts";

/**
 * CLI entry for `oke mode [local|docker]`.
 *
 * @param args - Args after `mode`
 */
export async function modeCli(args: readonly string[]): Promise<number> {
  const cwd = process.cwd();
  for (const a of args) {
    if (a === "--help" || a === "-h") {
      console.log(`oke mode [local|docker]

Show or set the default infrastructure mode for \`oke dev\`.
With no argument, prints the saved preference (or "unset").
`);
      return 0;
    }
  }

  const positional = args.find((a) => !a.startsWith("-"));
  if (positional === undefined) {
    const saved = await readDevMode(cwd);
    console.log(saved ?? "unset");
    return 0;
  }

  const mode = parseDevMode(positional);
  if (mode === null) {
    console.error(`oke mode: expected local|docker, got ${positional}`);
    return 1;
  }
  await writeDevMode(cwd, mode as DevMode);
  console.log(mode);
  return 0;
}
