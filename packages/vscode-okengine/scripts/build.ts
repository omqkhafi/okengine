/**
 * Bundle the VS Code extension for the Node extension host.
 */

import * as esbuild from "esbuild";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const pkg = join(root, "..");
const outfile = join(pkg, "out/extension.js");

await mkdir(dirname(outfile), { recursive: true });

await esbuild.build({
  entryPoints: [join(pkg, "src/extension.ts")],
  bundle: true,
  outfile,
  platform: "node",
  format: "cjs",
  target: "node18",
  external: ["vscode", "oxc-parser"],
  sourcemap: true,
  logLevel: "info",
});

console.log(`wrote ${outfile}`);
