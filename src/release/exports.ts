/**
 * Resolve published `package.json` exports into measurable bundle entries.
 *
 * Expands `./drivers/*` to concrete driver modules (tree-shaken subpaths).
 */

import { readdir } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const DRIVERS_DIR = join(ROOT, "src/drivers");

/** Report / snapshot group for a budget sample. */
export type BudgetGroup = "core" | "exports" | "drivers";

/** One published subpath ready for gzip measurement. */
export interface ExportBudgetTarget {
  /** Sample id — `export:<subpath>`. */
  readonly id: string;
  /** Package subpath (`.` or `./store`, `./drivers/postgres`, …). */
  readonly subpath: string;
  /** Short human label (`channel`, `postgres`, `okengine`, …). */
  readonly label: string;
  /** Report section. */
  readonly group: BudgetGroup;
  /** Absolute path to the TypeScript entry. */
  readonly entry: string;
}

/**
 * Short display name for a package subpath.
 *
 * @param subpath - `.` / `./channel` / `./drivers/postgres`
 */
export function exportBudgetLabel(subpath: string): string {
  if (subpath === ".") return "okengine";
  if (subpath.startsWith("./drivers/")) {
    return subpath.slice("./drivers/".length);
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
  return "exports";
}

interface PackageExports {
  readonly exports?: Readonly<Record<string, string>>;
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
export async function listDriverModules(
  driversDir = DRIVERS_DIR,
): Promise<readonly string[]> {
  const entries = await readdir(driversDir);
  return entries.filter(isMeasurableDriverFile).sort((a, b) => a.localeCompare(b));
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
}): Promise<readonly ExportBudgetTarget[]> {
  const root = options?.root ?? ROOT;
  const pkg =
    options?.pkg ??
    ((await Bun.file(join(root, "package.json")).json()) as PackageExports);
  const exportsMap = pkg.exports ?? {};
  const driversDir = options?.driversDir ?? join(root, "src/drivers");

  const targets: ExportBudgetTarget[] = [];

  for (const [subpath, entryRel] of Object.entries(exportsMap)) {
    if (subpath.endsWith("/*")) {
      if (subpath !== "./drivers/*") {
        throw new Error(
          `unsupported export glob ${subpath}: only ./drivers/* is expanded`,
        );
      }
      const modules = await listDriverModules(driversDir);
      for (const file of modules) {
        const name = basename(file, ".ts");
        const driverSubpath = `./drivers/${name}`;
        targets.push(targetFor(driverSubpath, join(driversDir, file)));
      }
      continue;
    }

    if (typeof entryRel !== "string") {
      throw new Error(`export ${subpath} must map to a string path`);
    }

    targets.push(targetFor(subpath, resolve(root, entryRel)));
  }

  targets.sort((a, b) => {
    const g = groupOrder(a.group) - groupOrder(b.group);
    if (g !== 0) return g;
    // Barrel `drivers` before concrete modules.
    if (a.subpath === "./drivers") return -1;
    if (b.subpath === "./drivers") return 1;
    if (a.subpath === ".") return -1;
    if (b.subpath === ".") return 1;
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
  if (group === "drivers") return 1;
  return 2;
}
