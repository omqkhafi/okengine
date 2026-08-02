/**
 * `oke ai` — AI element CLI commands.
 */

import { EXIT_OK, EXIT_USAGE } from "./exit.ts";
import { aiSetupHelp, parseAiSetupArgs, runAiSetup } from "./ai-setup/index.ts";

/**
 * CLI entry for `oke ai …`.
 *
 * @param args - Args after `ai`
 */
export async function aiCli(args: readonly string[]): Promise<number> {
  const [sub, ...rest] = args;

  if (sub === undefined || sub === "--help" || sub === "-h" || sub === "help") {
    console.log(`oke ai — AI element helpers

Commands:
  setup   Configure AI driver + models (interactive)

${aiSetupHelp()}`);
    return sub ? EXIT_OK : EXIT_USAGE;
  }

  if (sub === "setup") {
    try {
      return await runAiSetup(parseAiSetupArgs(rest));
    } catch (e) {
      console.error(e instanceof Error ? e.message : e);
      return 1;
    }
  }

  console.error(`oke ai: unknown subcommand ${sub}`);
  console.error("Run `oke ai --help` for usage.");
  return EXIT_USAGE;
}
