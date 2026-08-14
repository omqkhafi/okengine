import { describe, expect, test } from "bun:test";
import {
  addQueryTab,
  closeQueryTab,
  historyPreview,
  isDefaultQueryTitle,
  nextQueryTitle,
  pushQueryHistory,
  renameQueryTab,
  upsertSavedQuery,
  writeQueryTab,
} from "./query-session.ts";

const seed = [{ id: "a", title: "Query 1", text: "SELECT 1" }];

describe("query tabs", () => {
  test("names the next unused Query N", () => {
    expect(nextQueryTitle(seed)).toBe("Query 2");
    expect(nextQueryTitle([...seed, { id: "b", title: "Query 3", text: "" }])).toBe("Query 2");
  });

  test("adds and writes a tab", () => {
    const added = addQueryTab(seed, "SELECT 2");
    expect(added).toHaveLength(2);
    expect(added[1]?.title).toBe("Query 2");
    expect(writeQueryTab(added, added[1]!.id, "SELECT 3")[1]?.text).toBe("SELECT 3");
  });

  test("caps at 8 tabs", () => {
    let tabs = seed;
    for (let i = 0; i < 10; i += 1) tabs = [...addQueryTab(tabs, "x")];
    expect(tabs).toHaveLength(8);
  });

  test("detects placeholder Query N titles", () => {
    expect(isDefaultQueryTitle("Query 1")).toBe(true);
    expect(isDefaultQueryTitle("comments by issue")).toBe(false);
  });

  test("renames a tab and falls back when empty", () => {
    expect(renameQueryTab(seed, "a", "  comments by issue  ")[0]?.title).toBe("comments by issue");
    expect(renameQueryTab(seed, "a", "   ")[0]?.title).toBe("Query 1");
  });

  test("upserts saved queries by id", () => {
    const first = upsertSavedQuery([], { id: "a", title: "Q", text: "SELECT 1" });
    expect(first).toHaveLength(1);
    const second = upsertSavedQuery(first, { id: "a", title: "Q2", text: "SELECT 2" });
    expect(second).toHaveLength(1);
    expect(second[0]?.title).toBe("Q2");
    expect(second[0]?.text).toBe("SELECT 2");
  });

  test("closing the last tab reseeds", () => {
    const next = closeQueryTab(seed, "a", "SELECT 1;");
    expect(next).toHaveLength(1);
    expect(next[0]?.id).not.toBe("a");
    expect(next[0]?.text).toBe("SELECT 1;");
  });
});

describe("query history", () => {
  test("previews the first executable line", () => {
    expect(historyPreview("-- note\nSELECT * FROM t")).toBe("SELECT * FROM t");
    expect(historyPreview("")).toBe("(empty)");
  });

  test("prepends and caps history", () => {
    let entries = pushQueryHistory([], {
      at: 1,
      storeRef: "sql:db",
      text: "SELECT 1",
      ok: true,
      rowCount: 1,
      durationMs: 4,
    });
    expect(entries).toHaveLength(1);
    for (let i = 0; i < 30; i += 1) {
      entries = pushQueryHistory(entries, {
        at: i,
        storeRef: "sql:db",
        text: `SELECT ${i}`,
        ok: true,
        rowCount: 0,
        durationMs: 1,
      });
    }
    expect(entries).toHaveLength(24);
    expect(entries[0]?.text).toBe("SELECT 29");
  });
});
