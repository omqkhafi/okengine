/**
 * `oke branch <name> --at <when>` — fork journaled state into a sandbox.
 */

/** Options for {@link runBranch}. */
export interface BranchOptions {
  readonly name: string;
  readonly at?: string;
  readonly cwd?: string;
  readonly write?: (text: string) => void;
  /**
   * Fork hook (tests / wired journal).
   *
   * @param name - Branch name
   * @param at - Time expression
   */
  readonly fork?: (name: string, at: string | undefined) => Promise<string>;
}

/**
 * Fork journaled state into a named sandbox branch.
 *
 * @param options - Name / time
 */
export async function runBranch(options: BranchOptions): Promise<number> {
  const write = options.write ?? ((t) => process.stdout.write(t));
  if (!options.name) {
    console.error("Usage: oke branch <name> --at <when>");
    return 1;
  }
  const fork =
    options.fork ??
    (async (name, at) => {
      const dir = `${options.cwd ?? process.cwd()}/.oke/branches/${name}`;
      await Bun.write(
        `${dir}/meta.json`,
        `${JSON.stringify({ name, at: at ?? "now", createdAt: new Date().toISOString() }, null, 2)}\n`,
      );
      return dir;
    });
  try {
    const path = await fork(options.name, options.at);
    write(`oke branch: ${options.name} at ${options.at ?? "now"} → ${path}\n`);
    return 0;
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

/**
 * CLI entry for `oke branch`.
 *
 * @param args - Args after `branch`
 */
export async function branchCli(args: readonly string[]): Promise<number> {
  let name: string | undefined;
  let at: string | undefined;
  for (let i = 0; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--at") at = args[++i];
    else if (a === "--help" || a === "-h") {
      console.log(`oke branch <name> --at "yesterday"

Fork journaled state into a sandbox for replay / time-travel.
`);
      return 0;
    } else if (!a.startsWith("-") && !name) name = a;
  }
  if (!name) {
    console.error("Usage: oke branch <name> --at <when>");
    return 1;
  }
  return runBranch({ name, at });
}
