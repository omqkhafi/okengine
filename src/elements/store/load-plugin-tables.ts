/**
 * Load plugin table contributions from a live `oke()` app entry.
 *
 * Used by `oke db` emit so `.plug()`-registered `field.*` tables merge into
 * `schema.drizzle.ts` — not only at unit-test merge call sites.
 */

import { resolve } from "node:path";
import type { TableContribution } from "../../kernel/plugin.ts";
import type { PluginRegistry } from "../../kernel/registry.ts";

/** Duck-type for an app that exposes a plugin registry. */
export interface AppWithPlugins {
  readonly plugins: PluginRegistry;
}

/**
 * Whether `value` looks like an {@link AppWithPlugins}.
 *
 * @param value - Candidate export
 */
export function isAppWithPlugins(value: unknown): value is AppWithPlugins {
  if (!value || typeof value !== "object") return false;
  const plugins = (value as { plugins?: unknown }).plugins;
  if (!plugins || typeof plugins !== "object") return false;
  return typeof (plugins as PluginRegistry).tableContributions === "function";
}

/**
 * Find an `oke()` app export on a module (`app`, `default`, or first match).
 *
 * @param mod - Imported module namespace
 */
export function findAppWithPlugins(mod: Record<string, unknown>): AppWithPlugins | undefined {
  for (const key of ["app", "default", ...Object.keys(mod)]) {
    const value = mod[key];
    if (isAppWithPlugins(value)) return value;
  }
  return undefined;
}

/**
 * Resolve the app entry used to collect plugged plugin tables.
 *
 * @param cwd - Project root
 * @param explicit - Optional relative/absolute entry override
 */
export async function resolveAppEntryForPluginTables(
  cwd: string,
  explicit?: string,
): Promise<string | undefined> {
  if (explicit) return resolve(cwd, explicit);
  const pkgPath = resolve(cwd, "package.json");
  if (await Bun.file(pkgPath).exists()) {
    const pkg = (await Bun.file(pkgPath).json()) as {
      main?: string;
      okengine?: { entry?: string };
    };
    if (pkg.okengine?.entry) return resolve(cwd, pkg.okengine.entry);
    if (pkg.main) return resolve(cwd, pkg.main);
  }
  for (const candidate of ["src/app.ts", "src/index.ts", "index.ts", "app.ts"]) {
    const path = resolve(cwd, candidate);
    if (await Bun.file(path).exists()) return path;
  }
  return undefined;
}

/**
 * Import the app entry and return table contributions from its live registry.
 *
 * Does not boot the app — `.plug()` at module load is enough for capture.
 *
 * @param cwd - Project root
 * @param options - Entry override / write for diagnostics
 */
export async function loadPluginTablesFromAppEntry(
  cwd: string,
  options: {
    readonly entry?: string;
    readonly write?: (text: string) => void;
  } = {},
): Promise<readonly TableContribution[]> {
  const entryAbs = await resolveAppEntryForPluginTables(cwd, options.entry);
  if (!entryAbs) return [];
  if (!(await Bun.file(entryAbs).exists())) return [];

  let mod: Record<string, unknown>;
  try {
    mod = (await import(entryAbs)) as Record<string, unknown>;
  } catch (err) {
    options.write?.(
      `oke db: failed to load app entry for plugin tables (${entryAbs}): ${
        err instanceof Error ? err.message : String(err)
      }\n`,
    );
    throw err;
  }

  const app = findAppWithPlugins(mod);
  if (!app) return [];
  return app.plugins.tableContributions();
}
