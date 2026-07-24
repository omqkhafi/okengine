#!/usr/bin/env bun
/**
 * `oke` CLI entry.
 */

import { clientAddCli } from "./client-add.ts";
import { evalCli } from "./eval.ts";
import { gatesListCli } from "./gates-list.ts";
import { privacyEraseCli } from "./privacy-erase.ts";

const argv = process.argv.slice(2);
const [cmd, sub, ...rest] = argv;

if (cmd === "client" && sub === "add") {
  process.exit(await clientAddCli(rest));
}

if (cmd === "gates" && sub === "list") {
  process.exit(await gatesListCli(rest));
}

if (cmd === "eval") {
  process.exit(await evalCli(sub ? [sub, ...rest] : rest));
}

if (cmd === "privacy" && sub === "erase") {
  process.exit(await privacyEraseCli(rest));
}

if (cmd === undefined || cmd === "--help" || cmd === "-h") {
  console.log(`oke — okengine CLI

Commands:
  oke client add <url> [--out oke-client.d.ts]
  oke gates list [--manifest oke.manifest.json]
  oke eval [--manifest oke.manifest.json]
  oke privacy erase --subject <id>
`);
  process.exit(cmd ? 0 : 1);
}

console.error(`Unknown command: ${cmd}${sub ? ` ${sub}` : ""}`);
console.error("Run `oke --help` for usage.");
process.exit(1);
