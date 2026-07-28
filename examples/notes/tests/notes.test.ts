import { afterEach, expect, test } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

// `app.boot` is idempotent, so each test re-boots fresh memory drivers only
// after the previous boot is stopped.
afterEach(async () => {
  await app.stop();
});

test("create then read", async () => {
  const t = await createTestApp(app); // memory driver, automatic
  const { data } = await t.api.notes.create({ title: "First", body: "Hello" });
  const { data: note } = await t.api.notes.get({ id: data!.id });
  expect(note!.title).toBe("First");
});

test("list: envelope, cursor pages, q search", async () => {
  const t = await createTestApp(app);
  for (const title of ["alpha", "bravo", "charlie", "delta", "echo"]) {
    const { error } = await t.api.notes.create({ title, body: `body of ${title}` });
    expect(error).toBeNull();
  }

  // Success envelope nests the page: { data: { data, nextCursor }, error: null }.
  const page1 = await t.api.notes.list({ limit: 2 });
  expect(page1.error).toBeNull();
  expect(page1.data.data).toHaveLength(2);
  expect(typeof page1.data.nextCursor).toBe("string");

  const page2 = await t.api.notes.list({ limit: 2, cursor: page1.data.nextCursor });
  expect(page2.error).toBeNull();
  expect(page2.data.data).toHaveLength(2);
  expect(typeof page2.data.nextCursor).toBe("string");

  const page3 = await t.api.notes.list({ limit: 2, cursor: page2.data.nextCursor });
  expect(page3.error).toBeNull();
  expect(page3.data.data).toHaveLength(1);
  expect(page3.data.nextCursor).toBeNull();

  // Keyset order: createdAt DESC, id DESC — pages never overlap or skip rows.
  const all = [...page1.data.data, ...page2.data.data, ...page3.data.data];
  expect(new Set(all.map((n) => n.id)).size).toBe(5);
  for (let i = 1; i < all.length; i++) {
    expect(all[i - 1]!.createdAt).toBeGreaterThanOrEqual(all[i]!.createdAt);
  }

  // q composes into the same where (sqlite LIKE is ASCII case-insensitive).
  const found = await t.api.notes.list({ q: "ALPHA" });
  expect(found.error).toBeNull();
  expect(found.data.data.map((n) => n.title)).toEqual(["alpha"]);
  expect(found.data.nextCursor).toBeNull();

  const none = await t.api.notes.list({ q: "zzz" });
  expect(none.data.data).toHaveLength(0);
  expect(none.data.nextCursor).toBeNull();
});

test("update patches title/body and returns the full note", async () => {
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
  expect(removed).toBeNull();
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

// Live encoder check: today statusForFailure has no NotFound case → 400.
// The shared-kernel NotFound → 404 is a documented proposal only.
test("live HTTP encoder: 400 + NotFound envelope today; query-driven list", async () => {
  const t = await createTestApp(app);
  await t.api.notes.create({ title: "first", body: "one" });
  await t.api.notes.create({ title: "second", body: "two" });

  const missing = await app.fetch(
    new Request("http://localhost/notes/missing", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "x" }),
    }),
  );
  expect(missing.status).toBe(400); // not 404 until the proposal lands
  expect(await missing.json()).toEqual({ data: null, error: { code: "NotFound", data: {} } });

  const list = await app.fetch(new Request("http://localhost/notes?limit=1"));
  expect(list.status).toBe(200);
  const body = await list.json();
  expect(body.error).toBeNull();
  expect(body.data.data).toHaveLength(1);
  expect(typeof body.data.nextCursor).toBe("string");

  // The opaque cursor round-trips through the query string.
  const rest = await app.fetch(
    new Request(`http://localhost/notes?limit=5&cursor=${encodeURIComponent(body.data.nextCursor)}`),
  );
  const restBody = await rest.json();
  expect(restBody.error).toBeNull();
  expect(restBody.data.data).toHaveLength(1);
  expect(restBody.data.nextCursor).toBeNull();
  expect(restBody.data.data[0].id).not.toBe(body.data.data[0].id);

  const search = await app.fetch(new Request("http://localhost/notes?q=second"));
  const searchBody = await search.json();
  expect(searchBody.data.data.map((n: { title: string }) => n.title)).toEqual(["second"]);

  const badCursor = await app.fetch(new Request("http://localhost/notes?cursor=nope"));
  expect(badCursor.status).toBe(422);
});
