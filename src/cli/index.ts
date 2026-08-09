#!/usr/bin/env bun
/**
 * `oke` CLI entry.
 *
 * Bare `oke` (TTY) → interactive Ink TUI. `oke <command>` runs directly.
 */

import { aiCli } from "./ai.ts";
import { branchCli } from "./branch.ts";
import { buildCli } from "./build.ts";
import { clientAddCli } from "./client-add.ts";
import { completionCli } from "./completion.ts";
import { dbCli } from "./db.ts";
import { devCli } from "./dev.ts";
import { doctorCli } from "./doctor.ts";
import { dockerCli } from "./docker.ts";
import { evalCli } from "./eval.ts";
import { EXIT_CODE_HELP, EXIT_OK, EXIT_USAGE } from "./exit.ts";
import { gatesListCli } from "./gates-list.ts";
import { imagesCli } from "./images.ts";
import { modeCli } from "./mode.ts";
import { privacyEraseCli } from "./privacy-erase.ts";
import { formatOkeHelp } from "./registry.ts";
import { replayCli } from "./replay.ts";
import { schemaCli } from "./schema.ts";
import { stackCli } from "./stack.ts";
import { startCli } from "./start.ts";
import { testCli } from "./test.ts";
import { upgradeCli } from "./upgrade.ts";
import { vaultCli } from "./vault-cmd.ts";

const rawArgv = process.argv.slice(2);
const wantTui = rawArgv.includes("--tui");
const argv = rawArgv.filter((a) => a !== "--tui");
const [cmd, sub, ...rest] = argv;
/** Nested TUI / slash child — never re-enter the interactive shell. */
const noTui = process.env["OKE_NO_TUI"] === "1";

/**
 * Launch interactive TUI when allowed; otherwise print help (non-TTY).
 */
async function maybeLaunchTui(): Promise<never> {
  const { canRenderTui, launchTui } = await import("./tui/launch.ts");
  if (noTui || !canRenderTui(process.stdout)) {
    console.log(formatOkeHelp());
    process.exit(EXIT_USAGE);
  }
  process.exit(await launchTui(process.cwd()));
}

if (wantTui && !noTui) {
  await maybeLaunchTui();
}

if (cmd === "dev") {
  process.exit(await devCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "mode") {
  process.exit(await modeCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "test") {
  process.exit(await testCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "start") {
  process.exit(await startCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "doctor") {
  process.exit(await doctorCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "stack") {
  process.exit(await stackCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "schema") {
  process.exit(await schemaCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "db") {
  process.exit(await dbCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "client" && sub === "add") {
  process.exit(await clientAddCli(rest));
}

if (cmd === "vault") {
  process.exit(await vaultCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "docker") {
  process.exit(await dockerCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "images") {
  process.exit(await imagesCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "build") {
  process.exit(await buildCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "eval") {
  process.exit(await evalCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "ai") {
  process.exit(await aiCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "branch") {
  process.exit(await branchCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "replay") {
  process.exit(await replayCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "privacy" && sub === "erase") {
  process.exit(await privacyEraseCli(rest));
}

if (cmd === "upgrade") {
  process.exit(await upgradeCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "gates" && sub === "list") {
  process.exit(await gatesListCli(rest));
}

if (cmd === "completion") {
  process.exit(completionCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "--help" || cmd === "-h" || cmd === "help") {
  console.log(`${formatOkeHelp()}${EXIT_CODE_HELP}`);
  process.exit(EXIT_OK);
}

if (cmd === undefined) {
  // Bare `oke` — TUI on TTY; help + EXIT_USAGE when piped / CI / OKE_NO_TUI.
  await maybeLaunchTui();
}

console.error(`Unknown command: ${cmd}${sub ? ` ${sub}` : ""}`);
console.error("Run `oke --help` for usage.");
process.exit(EXIT_USAGE);
