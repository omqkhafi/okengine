import { describe, expect, test } from "bun:test";
import { listPage } from "./list-page.ts";

const rows = [
  { id: "iss_1", title: "Ship", teamId: "eng" },
  { id: "iss_2", title: "Shipping docs", teamId: "eng" },
  { id: "iss_3", title: "Design", teamId: "des" },
  { id: "iss_4", title: "Ship later", teamId: "eng" },
];

describe("listPage offset", () => {
  test("pages with total / limit / offset", () => {
    const page = listPage(rows, { limit: 2, offset: 0 });
    expect(page.data).toEqual(rows.slice(0, 2));
    expect(page.meta).toMatchObject({
      mode: "offset",
      total: 4,
      limit: 2,
      offset: 0,
      prev: null,
    });
    expect(page.meta.next?.cursor).toBeString();
    const next = listPage(rows, { limit: 2, offset: 2 });
    expect(next.meta).toMatchObject({ offset: 2, next: null });
    expect(next.meta.prev?.cursor).toBeString();
  });

  test("zero-config q searches every string field", () => {
    const page = listPage(rows, { q: "ship", limit: 10 });
    expect(page.data.map((r) => r.id)).toEqual(["iss_1", "iss_2", "iss_4"]);
  });

  test("extra keys auto-eq; id never auto-eqs", () => {
    const comments = [
      { id: "c_1", issueId: "iss_1", body: "Ship it" },
      { id: "c_2", issueId: "iss_1", body: "Later" },
      { id: "c_3", issueId: "iss_2", body: "Ship docs" },
    ];
    const byIssue = listPage(comments, { issueId: "iss_1", limit: 10 });
    expect(byIssue.data.map((r) => r.id)).toEqual(["c_1", "c_2"]);

    const nested = listPage(comments, { id: "c_1", q: "ship", limit: 10 });
    expect(nested.data.map((r) => r.id)).toEqual(["c_1", "c_3"]);
  });

  test("search + extra filter + limit cap", () => {
    const page = listPage(
      rows,
      { q: "ship", teamId: "eng", limit: 500 },
      { search: ["title"], maxLimit: 2 },
    );
    expect(page.data.map((r) => r.id)).toEqual(["iss_1", "iss_2"]);
    expect(page.meta).toMatchObject({ mode: "offset", total: 3, limit: 2 });
  });

  test("empty q returns every row", () => {
    const page = listPage(rows, { q: "" });
    expect(page.meta).toMatchObject({ total: 4 });
  });

  test("unknown orderBy is ignored; whitelist sorts", () => {
    const raw = listPage(rows, { orderBy: "nope" }, { order: ["title"] });
    expect(raw.data.map((r) => r.id)).toEqual(rows.map((r) => r.id));

    const sorted = listPage(rows, { orderBy: "title", order: "asc" }, { order: ["title"] });
    expect(sorted.data.map((r) => r.title)).toEqual([
      "Design",
      "Ship",
      "Ship later",
      "Shipping docs",
    ]);
  });

  test("offset next / prev walk as request bags", () => {
    const first = listPage(rows, { limit: 2 });
    expect(first.meta.next).not.toBeNull();
    expect(first.meta.prev).toBeNull();
    const second = listPage(rows, { limit: 2, ...first.meta.next });
    expect(second.data).toEqual(rows.slice(2, 4));
    expect(second.meta.next).toBeNull();
    const back = listPage(rows, { limit: 2, ...second.meta.prev });
    expect(back.data).toEqual(first.data);
    expect(() => listPage(rows, { cursor: "x" })).toThrow(/invalid cursor/);
  });
});

describe("listPage cursor", () => {
  test("requires cursor fields", () => {
    expect(() => listPage(rows, {}, { mode: "cursor" })).toThrow(/spec.cursor/);
  });

  test("rejects offset in cursor mode", () => {
    expect(() => listPage(rows, { offset: 1 }, { mode: "cursor", cursor: ["id"] })).toThrow(
      /offset/,
    );
  });

  test("keyset next / previous cursors", () => {
    const first = listPage(rows, { limit: 2 }, { mode: "cursor", cursor: ["id"] });
    expect(first.data.map((r) => r.id)).toEqual(["iss_1", "iss_2"]);
    expect(first.meta.mode).toBe("cursor");
    if (first.meta.mode !== "cursor") throw new Error("expected cursor meta");
    expect(first.meta.prev).toBeNull();
    expect(first.meta.next?.cursor).toBeString();

    const second = listPage(
      rows,
      { limit: 2, ...first.meta.next },
      { mode: "cursor", cursor: ["id"] },
    );
    expect(second.data.map((r) => r.id)).toEqual(["iss_3", "iss_4"]);
    if (second.meta.mode !== "cursor") throw new Error("expected cursor meta");
    expect(second.meta.next).toBeNull();
    expect(second.meta.prev?.cursor).toBeString();

    const back = listPage(
      rows,
      { limit: 2, ...second.meta.prev },
      { mode: "cursor", cursor: ["id"] },
    );
    expect(back.data.map((r) => r.id)).toEqual(["iss_1", "iss_2"]);
    if (back.meta.mode !== "cursor") throw new Error("expected cursor meta");
    expect(back.meta.prev).toBeNull();
    expect(back.meta.next).not.toBeNull();
  });

  test("invalid cursor throws", () => {
    expect(() =>
      listPage(rows, { cursor: "not-a-cursor" }, { mode: "cursor", cursor: ["id"] }),
    ).toThrow(/invalid cursor/);
  });
});

describe("PostgREST query", () => {
  const people = [
    { id: "1", age: 12, student: true, lastName: "Owen", title: "Kid" },
    { id: "2", age: 18, student: true, lastName: "Patel", title: "Student" },
    { id: "3", age: 22, student: false, lastName: "Owen", title: "Grad" },
    { id: "4", age: 14, student: true, lastName: "Ng", title: null as string | null },
  ];

  test("eq / gte / is.true", () => {
    const page = listPage(people, { age: "gte.18", student: "is.true" });
    expect(page.data.map((r) => r.id)).toEqual(["2"]);
  });

  test("or= and not.and", () => {
    const page = listPage(people, { or: "(age.lt.18,age.gt.21)" });
    expect(page.data.map((r) => r.id)).toEqual(["1", "3", "4"]);

    const nested = listPage(people, { or: "(age.eq.14,not.and(age.gte.11,age.lte.17))" });
    expect(nested.data.map((r) => r.id)).toEqual(["2", "3", "4"]);
  });

  test("like * wildcard, in-list, not.eq", () => {
    const like = listPage(people, { lastName: "like.O*" });
    expect(like.data.map((r) => r.lastName)).toEqual(["Owen", "Owen"]);

    const inn = listPage(people, { id: "in.(1,3)" });
    expect(inn.data.map((r) => r.id)).toEqual(["1", "3"]);

    const ne = listPage(people, { lastName: "not.eq.Owen" });
    expect(ne.data.map((r) => r.lastName)).toEqual(["Patel", "Ng"]);
  });

  test("like(any) modifier", () => {
    const page = listPage(people, { lastName: "like(any).{O*,P*}" });
    expect(page.data.map((r) => r.lastName)).toEqual(["Owen", "Patel", "Owen"]);
  });

  test("order= col.desc and nullslast", () => {
    const desc = listPage(people, { order: "age.desc" });
    expect(desc.data.map((r) => r.age)).toEqual([22, 18, 14, 12]);

    const nulls = listPage(people, { order: "title.asc.nullslast" });
    expect(nulls.data.map((r) => r.title)).toEqual(["Grad", "Kid", "Student", null]);
  });

  test("select= projection and alias", () => {
    const page = listPage(people, { select: "id,name:lastName" }, { filter: "none" });
    expect(page.data as unknown).toEqual([
      { id: "1", name: "Owen" },
      { id: "2", name: "Patel" },
      { id: "3", name: "Owen" },
      { id: "4", name: "Ng" },
    ]);
  });

  test("filter none rejects column params", () => {
    expect(() => listPage(people, { age: "eq.18" }, { filter: "none" })).toThrow(
      /unknown list param/,
    );
  });
});
