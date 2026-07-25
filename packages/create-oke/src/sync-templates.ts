#!/usr/bin/env bun
/**
 * prepack: copy `examples/<template>` into `templates/<template>` so the
 * published npm package can scaffold without the monorepo checkout.
 *
 * Applies the same skip rules as runtime scaffold (no node_modules, no
 * monorepo-only docker.test.ts).
 */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { join, relative, resolve } from "node:path";
import { packageRoot, TEMPLATES } from "./templates.ts";
import { shouldSkipTemplatePath } from "./transform.ts";

const pkg = packageRoot();
const examplesRoot = resolve(pkg, "../../examples");
const outRoot = join(pkg, "templates");

if (!existsSync(examplesRoot)) {
  console.error(`create-oke prepack: examples/ not found at ${examplesRoot}`);
  process.exit(1);
}

rmSync(outRoot, { recursive: true, force: true });
mkdirSync(outRoot, { recursive: true });

for (const id of TEMPLATES) {
  const src = join(examplesRoot, id);
  const dst = join(outRoot, id);
  if (!existsSync(src)) {
    console.error(`create-oke prepack: missing example ${src}`);
    process.exit(1);
  }
  copyFiltered(src, dst, src);
  console.log(`create-oke prepack: ${id}`);
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
