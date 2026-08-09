import { describe, expect, test } from "bun:test";
import { commonPrefix, filterSlashActions, parseSlashArgv, slashCatalog } from "./slash-catalog.ts";

describe("slashCatalog", () => {
  test("includes panel jumps and core cli commands", () => {
    const all = slashCatalog();
    expect(all.some((a) => a.id === "panel dashboard")).toBe(true);
    expect(all.some((a) => a.id === "dev")).toBe(true);
    expect(all.some((a) => a.id === "db push")).toBe(true);
    expect(all.some((a) => a.id === "db studio")).toBe(true);
    expect(all.some((a) => a.id === "doctor")).toBe(true);
  });

  test("filterSlashActions prefixes db", () => {
    const hits = filterSlashActions("db", 20);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((h) => h.id.includes("db") || h.summary.toLowerCase().includes("db"))).toBe(
      true,
    );
    expect(hits[0]?.id.startsWith("db")).toBe(true);
  });

  test("filterSlashActions empty returns top slice", () => {
    expect(filterSlashActions("", 5)).toHaveLength(5);
  });

  test("commonPrefix and parseSlashArgv", () => {
    expect(commonPrefix(["db push", "db studio", "db seed"])).toBe("db ");
    expect(parseSlashArgv("  db   push  ")).toEqual(["db", "push"]);
  });
});
