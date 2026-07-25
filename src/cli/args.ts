/**
 * Tiny argv helpers shared by `oke` subcommands.
 */

/**
 * True when `--json` / `-j` is present.
 *
 * @param args - Argv slice
 */
export function wantsJson(args: readonly string[]): boolean {
  return args.includes("--json") || args.includes("-j");
}

/**
 * Read a flag value for long and optional short forms.
 *
 * @param args - Argv slice
 * @param long - Long flag (e.g. `--config`)
 * @param short - Optional short flag (e.g. `-c`)
 */
export function flagValue(
  args: readonly string[],
  long: string,
  short?: string,
): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === long || (short !== undefined && a === short)) {
      return args[i + 1];
    }
    if (a.startsWith(`${long}=`)) return a.slice(long.length + 1);
    if (short && a.startsWith(`${short}=`)) return a.slice(short.length + 1);
  }
  return undefined;
}

/**
 * True when a boolean flag (long or short) is present.
 *
 * @param args - Argv slice
 * @param long - Long flag
 * @param short - Optional short flag
 */
export function hasFlag(
  args: readonly string[],
  long: string,
  short?: string,
): boolean {
  return args.includes(long) || (short !== undefined && args.includes(short));
}
