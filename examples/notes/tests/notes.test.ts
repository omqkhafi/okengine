import { afterEach, expect, test } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

// `app.boot` is idempotent, so each test re-boots fresh memory drivers only
// after the previous boot is stopped.
afterEach(async () => {
  await app.stop();
});

test("create returns 201 body then read", async () => {
  const t = await createTestApp(app); // memory driver, automatic
  const { data, error } = await t.api.notes.create({ title: "First", body: "Hello" });
  expect(error).toBeNull();
  expect(data!.title).toBe("First");

  const { data: note } = await t.api.notes.get({ id: data!.id });
  expect(note!.title).toBe("First");
});

test("list: cursor pages over the Stripe envelope (data + meta)", async () => {
  const t = await createTestApp(app);
  for (const title of ["alpha", "bravo", "charlie", "delta", "echo"]) {
    const { error } = await t.api.notes.create({ title, body: `body of ${title}` });
    expect(error).toBeNull();
  }

  // Success envelope is flat: { data: Note[], meta: { nextCursor, hasNextPage }, error: null }.
  const page1 = await t.api.notes.list({ limit: 2 });
  expect(page1.error).toBeNull();
  expect(page1.data).toHaveLength(2);
  expect(page1.meta!.hasNextPage).toBe(true);
  expect(typeof page1.meta!.nextCursor).toBe("string");

  const page2 = await t.api.notes.list({ limit: 2, cursor: page1.meta!.nextCursor });
  expect(page2.error).toBeNull();
  expect(page2.data).toHaveLength(2);
  expect(page2.meta!.hasNextPage).toBe(true);

  const page3 = await t.api.notes.list({ limit: 2, cursor: page2.meta!.nextCursor });
  expect(page3.error).toBeNull();
  expect(page3.data).toHaveLength(1);
  expect(page3.meta!.hasNextPage).toBe(false);
  expect(page3.meta!.nextCursor).toBeNull();

  // Keyset order: createdAt DESC, id DESC — pages never overlap or skip rows.
  const all = [...page1.data, ...page2.data, ...page3.data];
  expect(new Set(all.map((n) => n.id)).size).toBe(5);
  for (let i = 1; i < all.length; i++) {
    expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
  }
});

test("search: English and Arabic substring (UTF-8 values, ASCII casefold)", async () => {
  const t = await createTestApp(app);
  await t.api.notes.create({ title: "hello world", body: "en" });
  await t.api.notes.create({ title: "مرحبا بالعالم", body: "ar" });
  await t.api.notes.create({ title: "draft مرحبا note", body: "mixed" });

  // English substring, sqlite LIKE is ASCII case-insensitive.
  const en = await t.api.notes.list({ search: "HELLO" });
  expect(en.error).toBeNull();
  expect(en.data.map((n) => n.title)).toEqual(["hello world"]);

  // Arabic substring round-trips (percent-encoded on the wire).
  const ar = await t.api.notes.list({ search: "مرحبا" });
  expect(ar.error).toBeNull();
  expect(ar.data.map((n) => n.title).sort()).toEqual(["draft مرحبا note", "مرحبا بالعالم"]);

  // `q` is a wire alias of `search`.
  const q = await t.api.notes.list({ q: "مرحبا" });
  expect(q.error).toBeNull();
  expect(q.data).toHaveLength(2);

  const none = await t.api.notes.list({ search: "zzz" });
  expect(none.data).toHaveLength(0);
  expect(none.meta!.nextCursor).toBeNull();
});

test("filter ops, order, and select through the list URL", async () => {
  const t = await createTestApp(app);
  await t.api.notes.create({ title: "alpha one", body: "b1" });
  await t.api.notes.create({ title: "beta two", body: "b2" });
  await t.api.notes.create({ title: "ملاحظة عربية", body: "b3" });

  const eq = await t.api.notes.list({ title: "eq.alpha one" });
  expect(eq.data.map((n) => n.title)).toEqual(["alpha one"]);

  const like = await t.api.notes.list({ title: "ilike.*BETA*" });
  expect(like.data.map((n) => n.title)).toEqual(["beta two"]);

  const arabicEq = await t.api.notes.list({ title: "eq.ملاحظة عربية" });
  expect(arabicEq.data.map((n) => n.title)).toEqual(["ملاحظة عربية"]);

  const inn = await t.api.notes.list({ title: "in.(alpha one,beta two)" });
  expect(inn.data.map((n) => n.title).sort()).toEqual(["alpha one", "beta two"]);

  // order + select
  const ordered = await t.api.notes.list({ order: "title.asc", select: "id,title" });
  expect(ordered.data[0]!.title <= ordered.data[1]!.title).toBe(true);
  expect(Object.keys(ordered.data[0]!).sort()).toEqual(["id", "title"]);

  // unknown column / op → 422 validation error
  const badCol = await t.api.notes.list({ nope: "eq.x" });
  expect(badCol.error?.code).toBe("ValidationError");
  const badOp = await t.api.notes.list({ title: "bogus.x" });
  expect(badOp.error?.code).toBe("ValidationError");
});

test("update patches and returns the full note; remove answers 204", async () => {
  const t = await createTestApp(app);
  const { data: created } = await t.api.notes.create({ title: "before", body: "old body" });

  const { data: updated, error } = await t.api.notes.update({
    id: created!.id,
    title: "after",
  });
  expect(error).toBeNull();
  expect(updated!.id).toBe(created!.id);
  expect(updated!.title).toBe("after");
  expect(updated!.body).toBe("old body"); // untouched field survives

  const { data: removed, error: removeError } = await t.api.notes.remove({ id: created!.id });
  expect(removeError).toBeNull();
  expect(removed).toBeUndefined();
  expect((await t.api.notes.get({ id: created!.id })).error?.code).toBe("NotFound");
});

test("NotFound failure envelope for get/update/remove of a missing id", async () => {
  const t = await createTestApp(app);
  for (const call of [
    () => t.api.notes.get({ id: "missing" }),
    () => t.api.notes.update({ id: "missing", title: "x" }),
    () => t.api.notes.remove({ id: "missing" }),
  ]) {
    expect(await call()).toEqual({ data: null, error: { code: "NotFound", data: {} } });
  }
});

// Live HTTP check: statuses (201/200/204), meta envelope, list URL grammar.
test("live HTTP: 201/204 statuses, meta envelope, list URL grammar", async () => {
  const t = await createTestApp(app);
  // Seed through the frozen test clock so createdAt ordering is deterministic.
  await t.api.notes.create({ title: "first", body: "one" });
  await t.api.notes.create({ title: "second", body: "two" });

  // create → 201 with { data, error } (no meta) — a throwaway note we remove.
  const created = await app.fetch(
    new Request("http://localhost/notes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "third", body: "three" }),
    }),
  );
  expect(created.status).toBe(201);
  const createdBody = await created.json();
  expect(createdBody.error).toBeNull();
  expect(createdBody.data.title).toBe("third");

  // NotFound → 400 today (shared-kernel 404 is a documented proposal only).
  const missing = await app.fetch(
    new Request("http://localhost/notes/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    }),
  );
  expect(missing.status).toBe(400);
  expect(await missing.json()).toEqual({ data: null, error: { code: "NotFound", data: {} } });

  // remove → 204 no body (take the throwaway back out of the store).
  const removed = await app.fetch(
    new Request(`http://localhost/notes/${createdBody.data.id}`, { method: "DELETE" }),
  );
  expect(removed.status).toBe(204);

  // list → 200 with { data: [...], meta: { nextCursor, hasNextPage } }. With the
  // throwaway gone, only first + second remain: page1 takes one, rest the other.
  const list = await app.fetch(new Request("http://localhost/notes?limit=1"));
  expect(list.status).toBe(200);
  const body = await list.json();
  expect(body.error).toBeNull();
  expect(body.data).toHaveLength(1);
  expect(body.meta.hasNextPage).toBe(true);
  expect(typeof body.meta.nextCursor).toBe("string");

  // The opaque cursor round-trips through the query string.
  const rest = await app.fetch(
    new Request(
      `http://localhost/notes?limit=5&cursor=${encodeURIComponent(body.meta.nextCursor)}`,
    ),
  );
  const restBody = await rest.json();
  expect(restBody.error).toBeNull();
  expect(restBody.data).toHaveLength(1);
  expect(restBody.meta.hasNextPage).toBe(false);
  expect(restBody.data[0].id).not.toBe(body.data[0].id);

  const search = await app.fetch(new Request("http://localhost/notes?search=second"));
  const searchBody = await search.json();
  expect(searchBody.data.map((n: { title: string }) => n.title)).toEqual(["second"]);

  // UTF-8 Arabic value percent-encoded on the wire
  const arabic = await app.fetch(
    new Request(`http://localhost/notes?search=${encodeURIComponent("ثانية")}`),
  );
  expect(arabic.status).toBe(200);

  const badCursor = await app.fetch(new Request("http://localhost/notes?cursor=nope"));
  expect(badCursor.status).toBe(422);
});
