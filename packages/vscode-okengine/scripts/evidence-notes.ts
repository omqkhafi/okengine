/**
 * Manual-verification evidence: CodeLens titles for examples/notes flows.
 *
 * Run: `bun run --cwd packages/vscode-okengine evidence`
 * Open the printed file in the Extension Development Host to see CodeLens UI.
 */

import { readdir } from "node:fs/promises";
import { join, relative } from "node:path";
import { lensesForFile } from "../src/extract-bridge.ts";
import type { SourceFile } from "../../../src/compiler/extract.ts";

const repoRoot = join(import.meta.dir, "../../..");
const notesRoot = join(repoRoot, "examples/notes");

async function walkTs(dir: string, acc: string[] = []): Promise<string[]> {
  for (const name of await readdir(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name === ".git") continue;
    const full = join(dir, name.name);
    if (name.isDirectory()) {
      await walkTs(full, acc);
    } else if (/\.tsx?$/.test(name.name) && !name.name.endsWith(".test.ts")) {
      acc.push(full);
    }
  }
  return acc;
}

const paths = await walkTs(notesRoot);
const files: SourceFile[] = [];
for (const full of paths) {
  const path = relative(notesRoot, full).replace(/\\/g, "/");
  files.push({ path, source: await Bun.file(full).text() });
}

const target = "src/flows/notes/index.ts";
const lenses = await lensesForFile(target, files);

const lines = [
  "# CodeLens evidence — examples/notes",
  "",
  `Extractor: real \`extractManifest\` / \`lensesForFile\` (not a parallel parser).`,
  `File: \`${target}\``,
  "",
  "| Line (1-based) | Flow | CodeLens title |",
  "|---:|---|---|",
];

for (const lens of lenses) {
  lines.push(
    `| ${lens.line + 1} | \`${lens.flowId}\` | \`${lens.title}\` |`,
  );
}

if (lenses.length === 0) {
  lines.push("", "_No lenses — extraction returned no effects for this file._");
}

const outPath = join(import.meta.dir, "../evidence/notes-codelens.md");
await Bun.write(outPath, `${lines.join("\n")}\n`);
console.log(lines.join("\n"));
console.log(`\nwrote ${outPath}`);
