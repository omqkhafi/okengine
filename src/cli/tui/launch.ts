/**
 * Launch the interactive Ink TUI (dynamic-imported from the bin).
 */

import { clearTerminalScreen } from "../../term.ts";
import { EXIT_OK, EXIT_RUNTIME, EXIT_USAGE } from "../exit.ts";
import { formatOkeHelp } from "../registry.ts";

/**
 * True when stdout can host an interactive Ink app.
 *
 * @param stream - stdout-like
 */
export function canRenderTui(stream: { readonly isTTY?: boolean } = process.stdout): boolean {
  return stream.isTTY === true;
}

/**
 * Wipe the viewport so boot logs never sit above the Ink frame.
 */
export function clearTerminalViewport(): void {
  process.stdout.write(clearTerminalScreen());
}

/**
 * Start the TUI. Call only after {@link canRenderTui} is true.
 *
 * @param cwd - Project root
 */
export async function launchTui(cwd: string = process.cwd()): Promise<number> {
  try {
    clearTerminalViewport();
    const React = await import("react");
    const { render } = await import("ink");
    const { OkeTuiApp } = await import("./App.tsx");
    const instance = render(React.createElement(OkeTuiApp, { cwd }), {
      exitOnCtrlC: false,
    });
    await instance.waitUntilExit();
    return EXIT_OK;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const missing =
      /Cannot find (module|package)|ERR_MODULE_NOT_FOUND|Cannot find package/i.test(msg) ||
      msg.includes("'ink'") ||
      msg.includes('"ink"');
    if (missing) {
      console.error("oke: interactive TUI requires optional deps `ink` and `react`.");
      console.error("      bun add ink react");
      console.error("      Or run `oke --help` / `oke <command>` without the TUI.");
      console.log(formatOkeHelp());
      return EXIT_USAGE;
    }
    console.error(`oke: TUI failed — ${msg}`);
    return EXIT_RUNTIME;
  }
}
