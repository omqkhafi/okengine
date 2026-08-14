import { describe, expect, test } from "bun:test";
import {
  fillHits,
  pasteHits,
  pendingKey,
  pendingToUpdates,
  popPending,
  stagePending,
  type PendingCell,
} from "./pending-edits.ts";

const cell = (over: Partial<PendingCell> = {}): PendingCell => ({
  rowId: "r1",
  key: "note",
  prev: "old",
  next: "new",
  ...over,
});

describe("stagePending", () => {
  test("writes a cell and appends the log", () => {
    const { pending, log } = stagePending(new Map(), [], cell());
    expect(pending.get(pendingKey("r1", "note"))?.next).toBe("new");
    expect(log).toEqual([pendingKey("r1", "note")]);
  });

  test("restaging the same cell moves it to the end of the log", () => {
    let { pending, log } = stagePending(new Map(), [], cell());
    ({ pending, log } = stagePending(pending, log, cell({ key: "seats", prev: 1, next: 2 })));
    ({ pending, log } = stagePending(pending, log, cell({ next: "newer" })));
    expect(log).toEqual([pendingKey("r1", "seats"), pendingKey("r1", "note")]);
    expect(pending.get(pendingKey("r1", "note"))?.next).toBe("newer");
  });

  test("writing the original value back drops the cell", () => {
    const staged = stagePending(new Map(), [], cell());
    const { pending, log } = stagePending(staged.pending, staged.log, cell({ next: "old" }));
    expect(pending.size).toBe(0);
    expect(log).toEqual([]);
  });
});

describe("popPending", () => {
  test("removes the most recently staged cell", () => {
    let { pending, log } = stagePending(new Map(), [], cell());
    ({ pending, log } = stagePending(pending, log, cell({ key: "seats", prev: 1, next: 2 })));
    const popped = popPending(pending, log);
    expect(popped.popped?.key).toBe("seats");
    expect(popped.pending.size).toBe(1);
    expect(popped.log).toEqual([pendingKey("r1", "note")]);
  });

  test("empty log is a no-op", () => {
    const popped = popPending(new Map(), []);
    expect(popped.popped).toBeNull();
    expect(popped.log).toEqual([]);
  });
});

describe("pendingToUpdates", () => {
  test("flattens the map into cell updates", () => {
    const { pending } = stagePending(new Map(), [], cell());
    expect(pendingToUpdates(pending)).toEqual([
      { rowId: "r1", key: "note", prev: "old", next: "new" },
    ]);
  });
});

describe("pasteHits", () => {
  const writable = (_rowId: string, key: string) => key !== "id";

  test("tiles a single cell down selected rows", () => {
    const hits = pasteHits({
      matrix: [["hello"]],
      rowIds: ["a", "b", "c"],
      columnKeys: ["id", "note"],
      startCol: 1,
      writable,
    });
    expect(hits).toEqual([
      { rowId: "a", key: "note", text: "hello" },
      { rowId: "b", key: "note", text: "hello" },
      { rowId: "c", key: "note", text: "hello" },
    ]);
  });

  test("clips a taller clipboard to the selection", () => {
    const hits = pasteHits({
      matrix: [["one"], ["two"], ["three"]],
      rowIds: ["a", "b"],
      columnKeys: ["note"],
      startCol: 0,
      writable,
    });
    expect(hits.map((h) => h.text)).toEqual(["one", "two"]);
  });

  test("skips a read-only column but keeps later values aligned", () => {
    const hits = pasteHits({
      matrix: [["pk", "window"]],
      rowIds: ["a"],
      columnKeys: ["id", "note"],
      startCol: 0,
      writable,
    });
    expect(hits).toEqual([{ rowId: "a", key: "note", text: "window" }]);
  });
});

describe("fillHits", () => {
  test("writes the same text onto every writable cell in the range", () => {
    const hits = fillHits({
      range: { anchor: { row: 0, col: 1 }, head: { row: 2, col: 1 } },
      rowIds: ["a", "b", "c"],
      columnKeys: ["id", "note"],
      text: "hello",
      writable: (_rowId, key) => key !== "id",
    });
    expect(hits).toEqual([
      { rowId: "a", key: "note", text: "hello" },
      { rowId: "b", key: "note", text: "hello" },
      { rowId: "c", key: "note", text: "hello" },
    ]);
  });
});
