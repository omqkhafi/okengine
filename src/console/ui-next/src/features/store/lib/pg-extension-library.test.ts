import { describe, expect, test } from "bun:test";
import { PG_LIBRARY_EXTENSIONS } from "../../../../../../drivers/pg-extensions.ts";
import {
  availableLibraryExtensions,
  extensionInstallPlan,
  extensionInstallSql,
  featuredLibraryExtensions,
  groupLibraryExtensions,
  libraryExtensionTitle,
  libraryExtensionVendor,
  searchLibraryExtensions,
} from "./pg-extension-library.ts";

describe("pg-extension-library", () => {
  test("lists Timescale, PostGIS, pg_cron, and deeper packs", () => {
    const names = PG_LIBRARY_EXTENSIONS.map((e) => e.name);
    expect(names).toContain("timescaledb");
    expect(names).toContain("postgis");
    expect(names).toContain("pg_cron");
    expect(names).toContain("pg_duckdb");
    expect(names).toContain("plv8");
    expect(names).toContain("anon");
    expect(names).toContain("index_advisor");
    expect(names).toContain("hypopg");
  });

  test("index_advisor install plan requires hypopg and uses CASCADE on Enable", () => {
    const advisor = PG_LIBRARY_EXTENSIONS.find((e) => e.name === "index_advisor");
    expect(advisor?.requires).toEqual(["hypopg"]);
    const plan = extensionInstallPlan(advisor!, new Set(), { cascade: true });
    expect(plan.items.map((i) => i.name)).toEqual(["hypopg", "index_advisor"]);
    expect(plan.sql).toBe(
      [
        'CREATE EXTENSION IF NOT EXISTS "hypopg";',
        'CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH CASCADE;',
      ].join("\n"),
    );
    expect(libraryExtensionVendor("index_advisor")).toBe("Supabase");
    expect(libraryExtensionTitle("index_advisor")).toBe("Index Advisor");
  });

  test("hides extensions already on the catalog page", () => {
    const left = availableLibraryExtensions(["timescaledb", "plpgsql"]);
    expect(left.some((e) => e.name === "timescaledb")).toBe(false);
    expect(left.some((e) => e.name === "postgis")).toBe(true);
  });

  test("search matches aliases, tags, and requires", () => {
    const rows = availableLibraryExtensions([]);
    expect(searchLibraryExtensions(rows, "gis").some((e) => e.name === "postgis")).toBe(true);
    expect(searchLibraryExtensions(rows, "cron").map((e) => e.name)).toContain("pg_cron");
    expect(searchLibraryExtensions(rows, "timescale toolkit")[0]?.name).toBe("timescaledb_toolkit");
    expect(searchLibraryExtensions(rows, "duckdb").some((e) => e.name === "pg_duckdb")).toBe(true);
    expect(searchLibraryExtensions(rows, "routing").some((e) => e.name === "pgrouting")).toBe(true);
  });

  test("features Timescale, Cron, and PostGIS in showcase order", () => {
    const featured = featuredLibraryExtensions(PG_LIBRARY_EXTENSIONS);
    expect(featured.map((e) => e.name)).toEqual(["timescaledb", "pg_cron", "postgis"]);
    expect(libraryExtensionVendor("pg_cron")).toBe("Citus Data");
    expect(libraryExtensionVendor("pg_net")).toBe("Supabase");
  });

  test("titles every library pack with a name distinct from the key", () => {
    for (const ext of PG_LIBRARY_EXTENSIONS) {
      const title = libraryExtensionTitle(ext.name);
      expect(title.length).toBeGreaterThan(0);
      expect(title).not.toBe(ext.name);
    }
    expect(libraryExtensionTitle("timescaledb_toolkit")).toBe("Timescale Toolkit");
    expect(libraryExtensionTitle("pg_cron")).toBe("Cron");
    expect(libraryExtensionTitle("mysql_fdw")).toBe("MySQL FDW");
    expect(libraryExtensionTitle("amcheck")).toBe("AM Check");
    expect(libraryExtensionTitle("plpgsql")).toBe("PL/pgSQL");
  });

  test("install plan lists requires first and skips already-installed SQL", () => {
    const toolkit = PG_LIBRARY_EXTENSIONS.find((e) => e.name === "timescaledb_toolkit");
    expect(toolkit).toBeDefined();
    const plan = extensionInstallPlan(toolkit!, new Set(["timescaledb"]));
    expect(plan.items.map((i) => i.name)).toEqual(["timescaledb", "timescaledb_toolkit"]);
    expect(plan.items[0]?.already).toBe(true);
    expect(plan.sql).toBe('CREATE EXTENSION IF NOT EXISTS "timescaledb_toolkit";');
    const cron = extensionInstallPlan(
      PG_LIBRARY_EXTENSIONS.find((e) => e.name === "pg_cron")!,
      new Set(),
    );
    expect(cron.sql).toBe('CREATE EXTENSION IF NOT EXISTS "pg_cron";');
    expect(cron.note).toContain("cron.schedule");
  });

  test("install SQL accepts SCHEMA, VERSION, and CASCADE", () => {
    expect(
      extensionInstallSql("pg_cron", { schema: "extensions", version: "1.6", cascade: true }),
    ).toBe(
      'CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "extensions" VERSION \'1.6\' CASCADE;',
    );
    expect(extensionInstallSql("pg_cron", { schema: "pg_catalog" })).toBe(
      'CREATE EXTENSION IF NOT EXISTS "pg_cron";',
    );
    const toolkit = PG_LIBRARY_EXTENSIONS.find((e) => e.name === "timescaledb_toolkit")!;
    const plan = extensionInstallPlan(toolkit, new Set(), { schema: "ext", cascade: true });
    expect(plan.sql).toBe(
      [
        'CREATE EXTENSION IF NOT EXISTS "timescaledb";',
        'CREATE EXTENSION IF NOT EXISTS "timescaledb_toolkit" WITH SCHEMA "ext" CASCADE;',
      ].join("\n"),
    );
  });

  test("groups remaining rows by category", () => {
    const groups = groupLibraryExtensions(availableLibraryExtensions([]));
    expect(groups[0]?.category).toBe("time");
    expect(groups.some((g) => g.items.some((i) => i.name === "pg_cron"))).toBe(true);
    expect(groups.some((g) => g.category === "fdw")).toBe(true);
  });
});
