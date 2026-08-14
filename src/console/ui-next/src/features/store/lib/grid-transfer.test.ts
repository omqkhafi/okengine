import { describe, expect, test } from "bun:test";
import { STORE_PII_MASK } from "./patch.ts";
import {
  cellExportText,
  csvEscape,
  importHits,
  parseCsv,
  parseImportRecords,
  parseJsonRecords,
  recordsFromHeaderMatrix,
  rowsToCsv,
} from "./grid-transfer.ts";

describe("cellExportText", () => {
  test("empty for nullish, identity for scalars, JSON for objects", () => {
    expect(cellExportText(null)).toBe("");
    expect(cellExportText(undefined)).toBe("");
    expect(cellExportText("hi")).toBe("hi");
    expect(cellExportText(3)).toBe("3");
    expect(cellExportText({ n: 1 })).toBe('{"n":1}');
  });
});

describe("csvEscape / rowsToCsv / parseCsv", () => {
  test("quotes commas and doubled quotes", () => {
    expect(csvEscape("a,b")).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
    expect(csvEscape("plain")).toBe("plain");
  });

  test("roundtrips a headered table with commas and quotes", () => {
    const csv = rowsToCsv(
      ["id", "note"],
      [
        ["b1", "hello, world"],
        ["b2", 'say "hi"'],
      ],
    );
    expect(parseCsv(csv)).toEqual([
      ["id", "note"],
      ["b1", "hello, world"],
      ["b2", 'say "hi"'],
    ]);
  });

  test("strips BOM and ignores CR", () => {
    expect(parseCsv("\uFEFFa,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  test("throws on an unclosed quote", () => {
    expect(() => parseCsv('"oops')).toThrow("Unclosed CSV quote");
  });
});

describe("recordsFromHeaderMatrix / parseJsonRecords / parseImportRecords", () => {
  test("header-only CSV yields no records", () => {
    expect(recordsFromHeaderMatrix([["id", "note"]])).toEqual([]);
  });

  test("maps CSV rows onto records", () => {
    expect(
      recordsFromHeaderMatrix([
        ["id", "note"],
        ["b1", "hello"],
      ]),
    ).toEqual([{ id: "b1", note: "hello" }]);
  });

  test("JSON array of objects stringifies nested values", () => {
    expect(parseJsonRecords('[{"id":"k1","value":{"n":2}}]')).toEqual([
      { id: "k1", value: '{"n":2}' },
    ]);
  });

  test("detects JSON vs CSV vs TSV", () => {
    expect(parseImportRecords('[{"id":"a","note":"x"}]')).toEqual([{ id: "a", note: "x" }]);
    expect(parseImportRecords("id,note\na,x")).toEqual([{ id: "a", note: "x" }]);
    expect(parseImportRecords("id\tnote\na\tx")).toEqual([{ id: "a", note: "x" }]);
  });
});

describe("importHits", () => {
  const writable = (_rowId: string, key: string) => key !== "id" && key !== "key";

  test("matches by id and skips identity columns", () => {
    const { hits, unmatched } = importHits({
      records: [{ id: "b1", note: "hello", seats: "2" }],
      rowIds: new Set(["b1"]),
      writable,
    });
    expect(unmatched).toBe(0);
    expect(hits).toEqual([
      { rowId: "b1", key: "note", text: "hello" },
      { rowId: "b1", key: "seats", text: "2" },
    ]);
  });

  test("matches KV rows by key", () => {
    const { hits, unmatched } = importHits({
      records: [{ key: "sess:1", value: '{"n":1}' }],
      rowIds: new Set(["sess:1"]),
      writable,
    });
    expect(unmatched).toBe(0);
    expect(hits).toEqual([{ rowId: "sess:1", key: "value", text: '{"n":1}' }]);
  });

  test("counts unmatched rows and skips PII masks", () => {
    const { hits, unmatched } = importHits({
      records: [
        { id: "missing", note: "x" },
        { id: "b1", email: STORE_PII_MASK, note: "ok" },
      ],
      rowIds: new Set(["b1"]),
      writable,
    });
    expect(unmatched).toBe(1);
    expect(hits).toEqual([{ rowId: "b1", key: "note", text: "ok" }]);
  });
});
