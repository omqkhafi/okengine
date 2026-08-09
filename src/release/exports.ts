/**
 * Resolve published `package.json` exports into measurable bundle entries.
 *
 * Expands `./drivers/*` to concrete driver modules (tree-shaken subpaths).
 * Official `okengine/plugins` named modules are sampled separately (not published
 * as `./plugins/*` subpaths).
 */

import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import {
  OFFICIAL_PLUGIN_BUDGETS,
  type OfficialPluginBudget,
  type PluginBudgetCategory,
} from "./official-plugins.ts";

export {
  OFFICIAL_PLUGIN_BUDGETS,
  PLUGIN_BUDGET_CATEGORIES,
  type OfficialPluginBudget,
  type PluginBudgetCategory,
} from "./official-plugins.ts";

const ROOT = resolve(import.meta.dir, "../..");
const DRIVERS_DIR = join(ROOT, "src/drivers");
const PLUGINS_DIR = join(ROOT, "src/plugins");

/** Report / snapshot group for a budget sample. */
export type BudgetGroup = "core" | "exports" | "plugins" | "drivers";

/** One published subpath ready for gzip measurement. */
export interface ExportBudgetTarget {
  /** Sample id — `export:<subpath>`. */
  readonly id: string;
  /** Package subpath (`.` or `./store`, `./drivers/postgres`, `./plugins/cors`, …). */
  readonly subpath: string;
  /** Short human label (`channel`, `postgres`, `okengine`, …). */
  readonly label: string;
  /** Report section. */
  readonly group: BudgetGroup;
  /** Absolute path to the TypeScript entry. */
  readonly entry: string;
  /** Docs category when `group` is `plugins`. */
  readonly category?: PluginBudgetCategory;
}

/**
 * Short display name for a package subpath.
 *
 * @param subpath - `.` / `./channel` / `./drivers/postgres` / `./plugins/cors`
 */
export function exportBudgetLabel(subpath: string): string {
  if (subpath === ".") return "okengine";
  if (subpath.startsWith("./drivers/")) {
    return subpath.slice("./drivers/".length);
  }
  if (subpath.startsWith("./plugins/")) {
    return subpath.slice("./plugins/".length);
  }
  if (subpath.startsWith("./")) return subpath.slice(2);
  return subpath;
}

/**
 * Which report section a published export belongs to.
 *
 * @param subpath - Package export subpath
 */
export function exportBudgetGroup(subpath: string): BudgetGroup {
  if (subpath === "./drivers" || subpath.startsWith("./drivers/")) {
    return "drivers";
  }
  // Named plugin modules (not the `./plugins` barrel — that stays in exports).
  if (subpath.startsWith("./plugins/")) {
    return "plugins";
  }
  return "exports";
}

/** One package.json exports target (string path or conditional map). */
export type PackageExportTarget =
  | string
  | Readonly<Partial<Record<"types" | "bun" | "import" | "default" | "require", string>>>;

interface PackageExports {
  readonly exports?: Readonly<Record<string, PackageExportTarget>>;
}

/**
 * Resolve a package export target to the TypeScript source path used for budgets.
 *
 * Prefers `bun` / `types` (src) over compiled `import`/`default` (dist).
 *
 * @param target - Export target from package.json
 */
export function resolveExportSourcePath(target: PackageExportTarget): string {
  if (typeof target === "string") return target;
  const path = target.bun ?? target.types ?? target.import ?? target.default;
  if (!path || typeof path !== "string") {
    throw new Error("export target has no resolvable string path");
  }
  return path;
}

/**
 * Whether a driver filename is a measurable protocol module (not types/tests).
 *
 * @param name - Basename under `src/drivers/`
 */
export function isMeasurableDriverFile(name: string): boolean {
  if (!name.endsWith(".ts")) return false;
  if (name === "index.ts") return false;
  if (name === "conformance.ts") return false;
  if (name.endsWith(".test.ts")) return false;
  if (name.endsWith("-types.ts")) return false;
  if (name === "types.ts") return false;
  return true;
}

/**
 * Discover concrete `okengine/drivers/*` modules under `src/drivers/`.
 *
 * @param driversDir - Absolute drivers directory
 */
export async function listDriverModules(driversDir = DRIVERS_DIR): Promise<readonly string[]> {
  const entries = await readdir(driversDir);
  return entries.filter(isMeasurableDriverFile).sort((a, b) => a.localeCompare(b));
}

/**
 * Resolve official plugin modules into measurement targets.
 *
 * @param options - Override plugins dir (tests)
 */
export function resolvePluginBudgetTargets(options?: {
  readonly pluginsDir?: string;
  readonly catalogue?: readonly OfficialPluginBudget[];
}): readonly ExportBudgetTarget[] {
  const pluginsDir = options?.pluginsDir ?? PLUGINS_DIR;
  const catalogue = options?.catalogue ?? OFFICIAL_PLUGIN_BUDGETS;
  return catalogue.map((plugin) => {
    const subpath = `./plugins/${plugin.name}`;
    return {
      id: `export:${subpath}`,
      subpath,
      label: plugin.name,
      group: "plugins" as const,
      entry: join(pluginsDir, plugin.file),
      category: plugin.category,
    };
  });
}

/**
 * Resolve every published export into a stable, sorted measurement target list.
 *
 * @param options - Override package.json / drivers dir (tests)
 */
export async function resolveExportBudgetTargets(options?: {
  readonly root?: string;
  readonly pkg?: PackageExports;
  readonly driversDir?: string;
  readonly pluginsDir?: string;
}): Promise<readonly ExportBudgetTarget[]> {
  const root = options?.root ?? ROOT;
  const pkg =
    options?.pkg ?? ((await Bun.file(join(root, "package.json")).json()) as PackageExports);
  const exportsMap = pkg.exports ?? {};
  const driversDir = options?.driversDir ?? join(root, "src/drivers");
  const pluginsDir = options?.pluginsDir ?? join(root, "src/plugins");

  const targets: ExportBudgetTarget[] = [];

  for (const [subpath, entryTarget] of Object.entries(exportsMap)) {
    if (subpath.endsWith("/*")) {
      if (subpath !== "./drivers/*") {
        throw new Error(`unsupported export glob ${subpath}: only ./drivers/* is expanded`);
      }
      const modules = await listDriverModules(driversDir);
      for (const file of modules) {
        const name = basename(file, ".ts");
        const driverSubpath = `./drivers/${name}`;
        targets.push(targetFor(driverSubpath, join(driversDir, file)));
      }
      continue;
    }

    let entryRel: string;
    try {
      entryRel = resolveExportSourcePath(entryTarget);
    } catch {
      throw new Error(
        `export ${subpath} must map to a string path or conditional bun/types target`,
      );
    }

    targets.push(targetFor(subpath, resolve(root, entryRel)));
  }

  targets.push(...resolvePluginBudgetTargets({ pluginsDir }));

  targets.sort((a, b) => {
    const g = groupOrder(a.group) - groupOrder(b.group);
    if (g !== 0) return g;
    // Barrel `drivers` before concrete modules.
    if (a.subpath === "./drivers") return -1;
    if (b.subpath === "./drivers") return 1;
    if (a.subpath === ".") return -1;
    if (b.subpath === ".") return 1;
    // Catalogue order for plugins (docs category order).
    if (a.group === "plugins" && b.group === "plugins") {
      const ai = OFFICIAL_PLUGIN_BUDGETS.findIndex((p) => p.name === a.label);
      const bi = OFFICIAL_PLUGIN_BUDGETS.findIndex((p) => p.name === b.label);
      if (ai !== -1 && bi !== -1) return ai - bi;
    }
    return a.label.localeCompare(b.label);
  });
  return targets;
}

function targetFor(subpath: string, entry: string): ExportBudgetTarget {
  return {
    id: `export:${subpath}`,
    subpath,
    label: exportBudgetLabel(subpath),
    group: exportBudgetGroup(subpath),
    entry,
  };
}

function groupOrder(group: BudgetGroup): number {
  if (group === "exports") return 0;
  if (group === "plugins") return 1;
  if (group === "drivers") return 2;
  return 3;
}
