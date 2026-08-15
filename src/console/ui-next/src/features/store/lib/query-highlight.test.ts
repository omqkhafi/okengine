import { describe, expect, test } from "bun:test";
import { highlightQuery, type QueryHighlightKind } from "./query-highlight.ts";

function kinds(source: string, language: "sql" | "kv"): QueryHighlightKind[] {
  return highlightQuery(source, language).map((token) => token.kind);
}

function join(source: string, language: "sql" | "kv"): string {
  return highlightQuery(source, language)
    .map((token) => token.text)
    .join("");
}

describe("highlightQuery sql", () => {
  test("colors the default SELECT seed", () => {
    const source = `SELECT *\nFROM "issues"\nLIMIT 50;`;
    expect(join(source, "sql")).toBe(source);
    expect(highlightQuery(source, "sql")).toEqual([
      { kind: "keyword", text: "SELECT" },
      { kind: "text", text: " " },
      { kind: "operator", text: "*" },
      { kind: "text", text: "\n" },
      { kind: "keyword", text: "FROM" },
      { kind: "text", text: " " },
      { kind: "ident", text: `"issues"` },
      { kind: "text", text: "\n" },
      { kind: "keyword", text: "LIMIT" },
      { kind: "text", text: " " },
      { kind: "number", text: "50" },
      { kind: "punct", text: ";" },
    ]);
  });

  test("keeps strings and line comments out of the keyword set", () => {
    const source = "SELECT 'FROM' -- LIMIT\nFROM t";
    expect(join(source, "sql")).toBe(source);
    expect(kinds(source, "sql")).toEqual([
      "keyword",
      "text",
      "string",
      "text",
      "comment",
      "text",
      "keyword",
      "text",
    ]);
  });

  test("treats TRUE / FALSE / NULL as atoms", () => {
    expect(kinds("SELECT TRUE, NULL", "sql")).toEqual([
      "keyword",
      "text",
      "atom",
      "punct",
      "text",
      "atom",
    ]);
  });
});

describe("highlightQuery kv", () => {
  test("colors the default list seed", () => {
    const source = "// list  ·  get  ·  set  ·  delete  ·  ttl\nlist drafts:";
    expect(join(source, "kv")).toBe(source);
    expect(highlightQuery(source, "kv")).toEqual([
      { kind: "comment", text: "// list  ·  get  ·  set  ·  delete  ·  ttl" },
      { kind: "text", text: "\n" },
      { kind: "command", text: "list" },
      { kind: "text", text: " " },
      { kind: "ident", text: "drafts" },
      { kind: "punct", text: ":" },
    ]);
  });

  test("colors call-form set arguments", () => {
    const source = 'set("drafts:a", { "n": 2 }, "10m")';
    expect(join(source, "kv")).toBe(source);
    expect(kinds(source, "kv")).toEqual([
      "command",
      "punct",
      "string",
      "punct",
      "text",
      "punct",
      "text",
      "string",
      "punct",
      "text",
      "number",
      "text",
      "punct",
      "text",
      "string",
      "punct",
    ]);
  });

  test("marks value / ttl atoms and durations", () => {
    expect(kinds("ttl drafts:a", "kv")).toEqual(["command", "text", "ident", "punct", "ident"]);
    expect(kinds("set(k, value, 30m)", "kv")).toContain("atom");
    expect(highlightQuery("30m", "kv")).toEqual([{ kind: "number", text: "30m" }]);
  });
});
