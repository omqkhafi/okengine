#!/usr/bin/env bun
/**
 * Prebuild tree-shaken ESM library entries into `dist/` for non-Bun consumers.
 *
 * Bun itself resolves the `"bun"` export condition to TypeScript sources under
 * `src/`. This build is what `"import"` / `"default"` conditions point at.
 */

import { mkdir, rm } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { EXPORT_BUILD_EXTERNALS } from "./measure.ts";

const ROOT = resolve(import.meta.dir, "../..");
const DIST = join(ROOT, "dist");

/** Library entry points mirrored into `dist/`. */
const ENTRIES: readonly { readonly src: string; readonly out: string }[] = [
  { src: "src/index.ts", out: "dist/index.js" },
  { src: "src/http.ts", out: "dist/http.js" },
  { src: "src/kernel-entry.ts", out: "dist/kernel-entry.js" },
  { src: "src/full.ts", out: "dist/full.js" },
  { src: "src/i18n-entry.ts", out: "dist/i18n-entry.js" },
  { src: "src/compiler-entry.ts", out: "dist/compiler-entry.js" },
  { src: "src/journal-entry.ts", out: "dist/journal-entry.js" },
  // Lazy sync chunks — loaded via requirePackageModule when gate.auth is set.
  { src: "src/kernel/app-auth.ts", out: "dist/app-auth.js" },
  { src: "src/auth/config.ts", out: "dist/auth-config.js" },
];

/**
 * Build every library entry into `dist/`.
 */
export async function buildLib(): Promise<void> {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  for (const entry of ENTRIES) {
    const absIn = join(ROOT, entry.src);
    const absOut = join(ROOT, entry.out);
    await mkdir(dirname(absOut), { recursive: true });
    const result = await Bun.build({
      entrypoints: [absIn],
      outdir: dirname(absOut),
      naming: relative(DIST, absOut).replace(/\\/g, "/"),
      target: "bun",
      format: "esm",
      minify: false,
      sourcemap: "external",
      external: [...EXPORT_BUILD_EXTERNALS],
      splitting: false,
    });
    if (!result.success) {
      throw new Error(`build:lib failed for ${entry.src}:\n${result.logs.map(String).join("\n")}`);
    }
  }
}

if (import.meta.main) {
  await buildLib();
  console.log(`build:lib wrote ${ENTRIES.length} entries under dist/`);
}
