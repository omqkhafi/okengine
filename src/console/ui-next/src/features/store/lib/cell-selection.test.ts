import { describe, expect, test } from "bun:test";
import {
  clampCoord,
  coordKey,
  matrixToTsv,
  parseCoordKey,
  rangeArea,
  rangeBounds,
  rangeContains,
  rangeCoords,
  stepCoord,
  tsvToMatrix,
} from "./cell-selection.ts";

describe("rangeBounds", () => {
  test("normalizes reversed ranges", () => {
    expect(rangeBounds({ anchor: { row: 3, col: 2 }, head: { row: 1, col: 0 } })).toEqual({
      minRow: 1,
      maxRow: 3,
      minCol: 0,
      maxCol: 2,
    });
  });
});

describe("rangeContains", () => {
  const range = { anchor: { row: 1, col: 1 }, head: { row: 2, col: 3 } };

  test("includes edges and interior", () => {
    expect(rangeContains(range, 1, 1)).toBe(true);
    expect(rangeContains(range, 2, 3)).toBe(true);
    expect(rangeContains(range, 2, 2)).toBe(true);
  });

  test("excludes outside cells", () => {
    expect(rangeContains(range, 0, 2)).toBe(false);
    expect(rangeContains(range, 2, 4)).toBe(false);
  });
});

describe("rangeArea / rangeCoords", () => {
  test("area counts inclusive rectangle", () => {
    expect(rangeArea({ anchor: { row: 0, col: 0 }, head: { row: 1, col: 2 } })).toBe(6);
  });

  test("coords iterate row-major", () => {
    expect(rangeCoords({ anchor: { row: 0, col: 1 }, head: { row: 1, col: 2 } })).toEqual([
      { row: 0, col: 1 },
      { row: 0, col: 2 },
      { row: 1, col: 1 },
      { row: 1, col: 2 },
    ]);
  });
});

describe("coordKey / parseCoordKey", () => {
  test("roundtrips", () => {
    expect(parseCoordKey(coordKey(4, 7))).toEqual({ row: 4, col: 7 });
  });

  test("rejects malformed keys", () => {
    expect(parseCoordKey("nope")).toBeNull();
    expect(parseCoordKey("1:x")).toBeNull();
  });
});

describe("clampCoord", () => {
  test("clamps into bounds", () => {
    expect(clampCoord({ row: -1, col: 9 }, 5, 3)).toEqual({ row: 0, col: 3 });
    expect(clampCoord({ row: 8, col: 1 }, 5, 3)).toEqual({ row: 5, col: 1 });
  });
});

describe("stepCoord", () => {
  test("steps forward across row boundaries", () => {
    expect(stepCoord({ row: 0, col: 2 }, 1, 2, 2)).toEqual({ row: 1, col: 0 });
  });

  test("steps backward across row boundaries", () => {
    expect(stepCoord({ row: 1, col: 0 }, -1, 2, 2)).toEqual({ row: 0, col: 2 });
  });

  test("clamps at both ends", () => {
    expect(stepCoord({ row: 0, col: 0 }, -1, 2, 2)).toEqual({ row: 0, col: 0 });
    expect(stepCoord({ row: 2, col: 2 }, 1, 2, 2)).toEqual({ row: 2, col: 2 });
  });
});

describe("tsvToMatrix", () => {
  test("parses basic TSV", () => {
    expect(tsvToMatrix("a\tb\nc\td")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("handles CRLF and trailing newline", () => {
    expect(tsvToMatrix("a\tb\r\nc\td\r\n")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  test("keeps interior empty cells and rows", () => {
    expect(tsvToMatrix("a\t\tb\n\n")).toEqual([["a", "", "b"], [""]]);
  });

  test("empty text yields no rows", () => {
    expect(tsvToMatrix("")).toEqual([]);
  });
});

describe("matrixToTsv", () => {
  test("roundtrips rectangular data", () => {
    const matrix = [
      ["a", "b"],
      ["c", "d"],
    ];
    expect(tsvToMatrix(matrixToTsv(matrix))).toEqual(matrix);
  });

  test("collapses tabs and newlines inside cells", () => {
    expect(matrixToTsv([["a\tb", "c\nd"]])).toBe("a b\tc d");
  });
});
