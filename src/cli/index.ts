#!/usr/bin/env bun
/**
 * `oke` CLI entry.
 */

import { branchCli } from "./branch.ts";
import { buildCli } from "./build.ts";
import { clientAddCli } from "./client-add.ts";
import { devCli } from "./dev.ts";
import { doctorCli } from "./doctor.ts";
import { dockerCli } from "./docker.ts";
import { evalCli } from "./eval.ts";
import { gatesListCli } from "./gates-list.ts";
import { imagesCli } from "./images.ts";
import { privacyEraseCli } from "./privacy-erase.ts";
import { schemaCli } from "./schema.ts";
import { stackCli } from "./stack.ts";
import { startCli } from "./start.ts";
import { upgradeCli } from "./upgrade.ts";
import { vaultCli } from "./vault-cmd.ts";

const argv = process.argv.slice(2);
const [cmd, sub, ...rest] = argv;

if (cmd === "dev") {
  process.exit(await devCli(sub ? [sub, ...rest] : rest));
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

if (cmd === "branch") {
  process.exit(await branchCli(sub ? [sub, ...rest] : rest));
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

if (cmd === undefined || cmd === "--help" || cmd === "-h") {
  console.log(`oke — okengine CLI

Commands:
  oke dev [--stack|-s [roles]]   watch · hot reload · Console · client types
  oke start                      production entry (Docker CMD)
  oke doctor                     secrets · ports · schema drift
  oke doctor --diff              CI gate: undeclared contract breaks
  oke stack                      preview images/tags/ports (writes nothing)
  oke schema generate [--check]  core + plugin tables → schema/oke.ts
  oke client add <url>           ambient types for a separate frontend repo
  oke vault set|list|import|key rotate
  oke docker [--prod]            Dockerfile + compose.<role>.yml
  oke images pin                 tags → digests in oke.images.lock
  oke build [--target edge]      tree-shaken bundle
  oke eval                       prompt eval sets (CI gate)
  oke branch <name> --at <when>  fork journaled state
  oke privacy erase --subject    crypto-shred
  oke upgrade [--apply]          breaking-change codemods + diff
  oke gates list                 gate catalogue from Manifest
`);
  process.exit(cmd ? 0 : 1);
}

console.error(`Unknown command: ${cmd}${sub ? ` ${sub}` : ""}`);
console.error("Run `oke --help` for usage.");
process.exit(1);
