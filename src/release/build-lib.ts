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
  { src: "src/testing.ts", out: "dist/testing.js" },
  { src: "src/compiler-entry.ts", out: "dist/compiler-entry.js" },
  { src: "src/journal-entry.ts", out: "dist/journal-entry.js" },
  // Lazy sync chunks — loaded via requirePackageModule / computed require
  // when the feature actually runs (auth, list page, auto-cache).
  { src: "src/kernel/fx-runtime.ts", out: "dist/fx-runtime.js" },
  { src: "src/auth/config.ts", out: "dist/auth-config.js" },
  { src: "src/kernel/fx-auth-keys.ts", out: "dist/fx-auth-keys.js" },
  { src: "src/kernel/fx-auth-tenants.ts", out: "dist/fx-auth-tenants.js" },
  { src: "src/kernel/fx-tenant-store.ts", out: "dist/fx-tenant-store.js" },
  { src: "src/drivers/pg-vault-rls.ts", out: "dist/pg-vault-rls.js" },
  { src: "src/kernel/app-tenant.ts", out: "dist/app-tenant.js" },
  { src: "src/kernel/pipeline-tenant.ts", out: "dist/pipeline-tenant.js" },
  { src: "src/kernel/fx-live-stream.ts", out: "dist/fx-live-stream.js" },
  { src: "src/kernel/errors-live-resume.ts", out: "dist/errors-live-resume.js" },
  { src: "src/kernel/errors-tenant.ts", out: "dist/errors-tenant.js" },
  { src: "src/kernel/clock-durable.ts", out: "dist/clock-durable.js" },
  { src: "src/kernel/clock-reconcile.ts", out: "dist/clock-reconcile.js" },
  { src: "src/kernel/clock-per-tenant-name.ts", out: "dist/clock-per-tenant-name.js" },
  { src: "src/elements/store/schema-tenant.ts", out: "dist/schema-tenant.js" },
  { src: "src/kernel/list-page.ts", out: "dist/list-page.js" },
  { src: "src/kernel/http-resource.ts", out: "dist/http-resource.js" },
  { src: "src/elements/store/cache.ts", out: "dist/store-cache.js" },
  { src: "src/i18n/messages.ts", out: "dist/messages.js" },
  { src: "src/i18n/failure-message.ts", out: "dist/failure-message.js" },
  { src: "src/okid.ts", out: "dist/okid.js" },
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
      // Non-Bun consumers ship this output; minify keeps `dist/` compact.
      // Budgets measure a *separate* minified build (measure.ts), but the
      // published artifact should not ship full-size sources when the compiler
      // is available to minify at the same cost.
      minify: true,
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
