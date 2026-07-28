/**
 * `oke mode [local|docker]` — read or set the saved `oke dev` preference.
 */

import { parseDevMode, readDevMode, writeDevMode, type DevMode } from "./dev-mode.ts";

/**
 * CLI entry for `oke mode`.
 *
 * @param args - Args after `mode`
 */
export async function modeCli(args: readonly string[]): Promise<number> {
  const cwd = process.cwd();
  for (const a of args) {
    if (a === "--help" || a === "-h") {
      console.log(`oke mode [local|docker]

Get or set the default infrastructure mode for \`oke dev\`
(saved in .oke/mode). Session flags \`oke dev --local\` /
\`oke dev --docker\` never change this preference.
`);
      return 0;
    }
  }

  const positional = args.filter((a) => !a.startsWith("-"));
  if (positional.length === 0) {
    const saved = await readDevMode(cwd);
    if (saved === null) {
      console.log("oke mode: unset (default local until chosen)");
      return 0;
    }
    console.log(saved);
    return 0;
  }

  const next = parseDevMode(positional[0]);
  if (next === null) {
    console.error(`oke mode: expected local|docker, got ${JSON.stringify(positional[0])}`);
    return 1;
  }
  await writeDevMode(cwd, next satisfies DevMode);
  console.log(`oke mode: saved ${next}`);
  return 0;
}
