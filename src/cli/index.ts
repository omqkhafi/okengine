#!/usr/bin/env bun
/**
 * `oke` CLI entry.
 */

import { clientAddCli } from "./client-add.ts";
import { gatesListCli } from "./gates-list.ts";

const argv = process.argv.slice(2);
const [cmd, sub, ...rest] = argv;

if (cmd === "client" && sub === "add") {
  process.exit(await clientAddCli(rest));
}

if (cmd === "gates" && sub === "list") {
  process.exit(await gatesListCli(rest));
}

if (cmd === undefined || cmd === "--help" || cmd === "-h") {
  console.log(`oke — okengine CLI

Commands:
  oke client add <url> [--out oke-client.d.ts]
  oke gates list [--manifest oke.manifest.json]
`);
  process.exit(cmd ? 0 : 1);
}

console.error(`Unknown command: ${cmd}${sub ? ` ${sub}` : ""}`);
console.error("Run `oke --help` for usage.");
process.exit(1);
