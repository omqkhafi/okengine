#!/usr/bin/env bun
/**
 * prepack: copy repo-root `templates/` and `examples/` into this package so the
 * published npm package can scaffold without the monorepo checkout.
 *
 * Applies the same skip rules as runtime scaffold (no node_modules, no
 * monorepo-only docker.test.ts).
 */

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { EXAMPLES, packageRoot, TEMPLATES } from "./templates.ts";
import { shouldSkipTemplatePath } from "./transform.ts";

const pkg = packageRoot();
const templatesRoot = resolve(pkg, "../../templates");
const examplesRoot = resolve(pkg, "../../examples");
const outTemplates = join(pkg, "templates");
const outExamples = join(pkg, "examples");

if (!existsSync(templatesRoot)) {
  console.error(`create-oke prepack: templates/ not found at ${templatesRoot}`);
  process.exit(1);
}
if (!existsSync(examplesRoot)) {
  console.error(`create-oke prepack: examples/ not found at ${examplesRoot}`);
  process.exit(1);
}

rmSync(outTemplates, { recursive: true, force: true });
rmSync(outExamples, { recursive: true, force: true });
mkdirSync(outTemplates, { recursive: true });
mkdirSync(outExamples, { recursive: true });

for (const id of TEMPLATES) {
  const src = join(templatesRoot, id);
  const dst = join(outTemplates, id);
  if (!existsSync(src)) {
    console.error(`create-oke prepack: missing template ${src}`);
    process.exit(1);
  }
  copyFiltered(src, dst, src);
  console.log(`create-oke prepack: template ${id}`);
}

for (const id of EXAMPLES) {
  const src = join(examplesRoot, id);
  const dst = join(outExamples, id);
  if (!existsSync(src)) {
    console.error(`create-oke prepack: missing example ${src}`);
    process.exit(1);
  }
  copyFiltered(src, dst, src);
  console.log(`create-oke prepack: example ${id}`);
}

/**
 * @param src - Source file or directory
 * @param dst - Destination path
 * @param root - Template root for relative skip paths
 */
function copyFiltered(src: string, dst: string, root: string): void {
  const st = statSync(src);
  const rel = relative(root, src).split(/[/\\]/).join("/");
  if (rel && shouldSkipTemplatePath(rel)) return;
  if (st.isDirectory()) {
    mkdirSync(dst, { recursive: true });
    for (const entry of readdirSync(src)) {
      copyFiltered(join(src, entry), join(dst, entry), root);
    }
    return;
  }
  if (st.isFile()) {
    mkdirSync(join(dst, ".."), { recursive: true });
    cpSync(src, dst);
  }
}
