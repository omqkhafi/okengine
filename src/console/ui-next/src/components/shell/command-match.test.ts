import { describe, expect, test } from "bun:test";
import { filterCommandItems, fuzzyMatch } from "./command-match.ts";

describe("fuzzyMatch", () => {
  test("empty needle matches anything", () => {
    expect(fuzzyMatch("", "Overview")).toBe(true);
  });

  test("matches a subsequence", () => {
    expect(fuzzyMatch("ovr", "Overview")).toBe(true);
    expect(fuzzyMatch("flo", "Flows")).toBe(true);
    expect(fuzzyMatch("xyz", "Overview")).toBe(false);
  });

  test("is case-insensitive", () => {
    expect(fuzzyMatch("STORE", "store")).toBe(true);
  });
});

describe("filterCommandItems", () => {
  const items = [
    { label: "Overview", group: "Navigate", keywords: ["home"] },
    { label: "Logout", group: "Account", keywords: ["sign out"] },
  ] as const;

  test("returns all items when the query is empty", () => {
    expect(filterCommandItems(items, "")).toEqual(items);
  });

  test("matches keywords", () => {
    expect(filterCommandItems(items, "sign").map((item) => item.label)).toEqual(["Logout"]);
  });

  test("matches group names", () => {
    expect(filterCommandItems(items, "nav").map((item) => item.label)).toEqual(["Overview"]);
  });
});
