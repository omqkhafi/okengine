/**
 * Published-export discovery for bundle budgets.
 */

import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import {
  exportBudgetGroup,
  exportBudgetLabel,
  isMeasurableDriverFile,
  listDriverModules,
  OFFICIAL_PLUGIN_BUDGETS,
  resolveExportBudgetTargets,
  resolvePluginBudgetTargets,
} from "./exports.ts";

const ROOT = resolve(import.meta.dir, "../..");

describe("export budget targets", () => {
  test("isMeasurableDriverFile excludes types, tests, barrel, conformance", () => {
    expect(isMeasurableDriverFile("postgres.ts")).toBe(true);
    expect(isMeasurableDriverFile("index.ts")).toBe(false);
    expect(isMeasurableDriverFile("types.ts")).toBe(false);
    expect(isMeasurableDriverFile("signal-types.ts")).toBe(false);
    expect(isMeasurableDriverFile("conformance.ts")).toBe(false);
    expect(isMeasurableDriverFile("conformance.test.ts")).toBe(false);
    expect(isMeasurableDriverFile("ai-providers.test.ts")).toBe(false);
  });

  test("exportBudgetLabel / group use short names", () => {
    expect(exportBudgetLabel(".")).toBe("okengine");
    expect(exportBudgetLabel("./channel")).toBe("channel");
    expect(exportBudgetLabel("./drivers/postgres")).toBe("postgres");
    expect(exportBudgetLabel("./plugins/cors")).toBe("cors");
    expect(exportBudgetGroup(".")).toBe("exports");
    expect(exportBudgetGroup("./channel")).toBe("exports");
    expect(exportBudgetGroup("./plugins")).toBe("exports");
    expect(exportBudgetGroup("./plugins/cors")).toBe("plugins");
    expect(exportBudgetGroup("./drivers")).toBe("drivers");
    expect(exportBudgetGroup("./drivers/postgres")).toBe("drivers");
  });

  test("official plugin catalogue files exist and resolve uniquely", async () => {
    const plugins = resolvePluginBudgetTargets();
    expect(plugins.length).toBe(OFFICIAL_PLUGIN_BUDGETS.length);
    expect(new Set(plugins.map((t) => t.id)).size).toBe(plugins.length);

    for (const plugin of OFFICIAL_PLUGIN_BUDGETS) {
      const path = join(ROOT, "src/plugins", plugin.file);
      expect(await Bun.file(path).exists()).toBe(true);
      const target = plugins.find((t) => t.label === plugin.name);
      expect(target).toBeDefined();
      expect(target!.id).toBe(`export:./plugins/${plugin.name}`);
      expect(target!.group).toBe("plugins");
      expect(target!.category).toBe(plugin.category);
      expect(target!.entry).toBe(path);
    }
  });

  test("every non-glob package export and every driver module is covered", async () => {
    const pkg = (await Bun.file(join(ROOT, "package.json")).json()) as {
      exports: Record<string, string>;
    };
    const targets = await resolveExportBudgetTargets();
    const bySubpath = new Map(targets.map((t) => [t.subpath, t]));

    for (const [subpath, entryRel] of Object.entries(pkg.exports)) {
      if (subpath.endsWith("/*")) continue;
      const target = bySubpath.get(subpath);
      expect(target).toBeDefined();
      expect(target!.id).toBe(`export:${subpath}`);
      expect(target!.label).toBe(exportBudgetLabel(subpath));
      expect(target!.group).toBe(exportBudgetGroup(subpath));
      expect(target!.entry).toBe(resolve(ROOT, entryRel));
    }

    const drivers = await listDriverModules();
    expect(drivers.length).toBeGreaterThan(0);
    for (const file of drivers) {
      const name = file.replace(/\.ts$/, "");
      const subpath = `./drivers/${name}`;
      const target = bySubpath.get(subpath);
      expect(target).toBeDefined();
      expect(target!.id).toBe(`export:${subpath}`);
      expect(target!.label).toBe(name);
      expect(target!.group).toBe("drivers");
      expect(target!.entry).toBe(join(ROOT, "src/drivers", file));
    }

    for (const plugin of OFFICIAL_PLUGIN_BUDGETS) {
      expect(bySubpath.get(`./plugins/${plugin.name}`)).toBeDefined();
    }

    // No duplicates.
    expect(new Set(targets.map((t) => t.id)).size).toBe(targets.length);
  });
});
