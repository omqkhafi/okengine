import { describe, expect, test } from "bun:test";
import {
  asSearchRecord,
  isConsoleModulePath,
  lastSearchFor,
  parseLastModuleSearch,
  rememberModuleSearch,
} from "./last-module-search.ts";

describe("last-module-search", () => {
  test("only Console modules are remembered", () => {
    expect(isConsoleModulePath("/overview")).toBe(true);
    expect(isConsoleModulePath("/flows")).toBe(true);
    expect(isConsoleModulePath("/monitoring")).toBe(true);
    expect(isConsoleModulePath("/units")).toBe(false);
    expect(isConsoleModulePath("/")).toBe(false);
    const left = rememberModuleSearch({}, "/overview", { run: "iss-1", flow: "issues.get" });
    expect(rememberModuleSearch(left, "/", { next: "/overview" })).toEqual(left);
    expect(lastSearchFor(left, "/overview")).toEqual({ run: "iss-1", flow: "issues.get" });
    expect(lastSearchFor(left, "/flows")).toEqual({});
    expect(rememberModuleSearch(left, "/overview", { run: "iss-1", flow: "issues.get" })).toBe(
      left,
    );
  });

  test("parse ignores junk and keeps known modules", () => {
    expect(parseLastModuleSearch(null)).toEqual({});
    expect(parseLastModuleSearch("{")).toEqual({});
    expect(parseLastModuleSearch('{"/dashboard":{"x":1}}')).toEqual({});
    expect(
      parseLastModuleSearch('{"/store":{"resource":"sql:issues"},"/overview":{"run":"r1"}}'),
    ).toEqual({
      "/store": { resource: "sql:issues" },
      "/overview": { run: "r1" },
    });
  });

  test("asSearchRecord copies plain objects only", () => {
    expect(asSearchRecord({ flow: "issues.list" })).toEqual({ flow: "issues.list" });
    expect(asSearchRecord("?flow=issues.list")).toEqual({});
    expect(asSearchRecord(["flow"])).toEqual({});
  });
});
