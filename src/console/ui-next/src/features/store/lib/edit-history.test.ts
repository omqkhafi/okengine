import { describe, expect, test } from "bun:test";
import {
  EMPTY_EDIT_HISTORY,
  invertEditBatch,
  popRedo,
  popUndo,
  pushEditBatch,
  type EditBatch,
} from "./edit-history.ts";

const batch = (n: number): EditBatch => ({
  at: n,
  updates: [{ rowId: `r${n}`, key: "name", prev: `old${n}`, next: `new${n}` }],
});

describe("pushEditBatch", () => {
  test("appends and clears the redo stack", () => {
    let h = pushEditBatch(EMPTY_EDIT_HISTORY, batch(1));
    h = { past: h.past, future: [batch(99)] };
    h = pushEditBatch(h, batch(2));
    expect(h.past.map((b) => b.at)).toEqual([1, 2]);
    expect(h.future).toEqual([]);
  });

  test("caps history depth", () => {
    let h = EMPTY_EDIT_HISTORY;
    for (let i = 0; i < 105; i++) h = pushEditBatch(h, batch(i), 100);
    expect(h.past.length).toBe(100);
    expect(h.past[0]?.at).toBe(5);
  });
});

describe("popUndo / popRedo", () => {
  test("undo moves batch to future, redo restores it", () => {
    let h = pushEditBatch(EMPTY_EDIT_HISTORY, batch(1));
    h = pushEditBatch(h, batch(2));

    const undone = popUndo(h);
    expect(undone.batch?.at).toBe(2);
    expect(undone.history.past.map((b) => b.at)).toEqual([1]);
    expect(undone.history.future.map((b) => b.at)).toEqual([2]);

    const redone = popRedo(undone.history);
    expect(redone.batch?.at).toBe(2);
    expect(redone.history.past.map((b) => b.at)).toEqual([1, 2]);
    expect(redone.history.future).toEqual([]);
  });

  test("empty stacks return null batch", () => {
    expect(popUndo(EMPTY_EDIT_HISTORY).batch).toBeNull();
    expect(popRedo(EMPTY_EDIT_HISTORY).batch).toBeNull();
  });
});

describe("invertEditBatch", () => {
  test("swaps prev and next", () => {
    const inverted = invertEditBatch(batch(1));
    expect(inverted.updates[0]).toEqual({ rowId: "r1", key: "name", prev: "new1", next: "old1" });
  });
});
