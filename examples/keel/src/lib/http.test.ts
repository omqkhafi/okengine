import { describe, expect, test } from "bun:test";
import { z } from "zod";
import {
  CursorListIn,
  CursorMeta,
  ListInBase,
  OffsetListIn,
  OffsetMeta,
  listIn,
  pageOut,
  parseRow,
  queryPage,
} from "./http.ts";

const Item = z.object({
  id: z.string(),
  title: z.string(),
  teamId: z.string(),
});

describe("listIn / page types", () => {
  test("base list query has no pagination field", () => {
    expect(ListInBase.parse({ q: "ship" })).toEqual({ q: "ship" });
  });

  test("offset and cursor list inputs extend the base", () => {
    expect(OffsetListIn.parse({ offset: 2, limit: 10 })).toEqual({ offset: 2, limit: 10 });
    expect(CursorListIn.parse({ cursor: "abc" })).toEqual({ cursor: "abc" });
    expect(() => OffsetListIn.parse({ offset: -1 })).toThrow();
  });

  test("listIn({ mode }) only exposes that mode's field", () => {
    const offset = listIn({ mode: "offset" }, { teamKey: z.string().optional() });
    expect(offset.parse({ teamKey: "ENG", offset: 0 })).toEqual({ teamKey: "ENG", offset: 0 });
    expect((offset as z.ZodType).parse({ cursor: "x" })).toEqual({ cursor: "x" });

    const cursor = listIn({ mode: "cursor" });
    expect(cursor.parse({ cursor: "tok" })).toEqual({ cursor: "tok" });
    expect(cursor.parse({ offset: 3 })).toEqual({ offset: 3 });
  });

  test("pageOut is the data array; meta variants extend the base", () => {
    expect(pageOut(Item).parse([{ id: "iss_1", title: "Ship", teamId: "eng" }])).toHaveLength(1);
    expect(
      OffsetMeta.parse({
        mode: "offset",
        total: 7,
        limit: 2,
        offset: 0,
        next: { cursor: "n" },
        prev: null,
      }).mode,
    ).toBe("offset");
    expect(
      CursorMeta.parse({
        mode: "cursor",
        limit: 2,
        next: null,
        prev: null,
      }).mode,
    ).toBe("cursor");
  });

  test("parseRow runs the item schema", () => {
    expect(parseRow(Item, { id: "iss_1", title: "Ship", teamId: "eng" }).id).toBe("iss_1");
  });

  test("queryPage searches and offsets in memory", () => {
    const rows = [
      { id: "a", title: "SSO login fails" },
      { id: "b", title: "Billing webhook" },
    ];
    const page = queryPage(rows, { q: "sso", limit: 10, offset: 0 }, { search: ["title"] });
    expect(page.data).toHaveLength(1);
    expect(page.data[0]?.id).toBe("a");
    expect(page.meta.total).toBe(1);
  });
});
