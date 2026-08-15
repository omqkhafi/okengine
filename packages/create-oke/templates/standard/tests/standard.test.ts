import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "@/app";

let t: TestApp<App>;

beforeAll(async () => {
  t = await createTestApp(app);
});

afterAll(async () => {
  await t.close();
});

test("boots — health flow is named main.health", async () => {
  const { data, error } = await t.api.main!.health!({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

test("notes create → list → archive", async () => {
  const created = await t.api.notes!.create!({
    title: "Hello",
    body: "World from the standard starter",
  });
  expect(created.error).toBeNull();
  const row = created.data as { id: string; title: string };
  expect(row.title).toBe("Hello");
  expect(row.id).toBeTruthy();

  await t.signals.drain();
  expect(t.channels.sent().some((s) => s.template === "note-created")).toBe(true);

  const listed = await t.api.notes!.list!({});
  expect(listed.error).toBeNull();
  const notes = listed.data as { id: string }[];
  expect(listed.meta).toMatchObject({ mode: "offset", offset: 0, next: null, prev: null });
  expect(notes.some((n) => n.id === row.id)).toBe(true);

  const archived = await t.api.notes!.archive!({ id: row.id });
  expect(archived.error).toBeNull();
  expect((archived.data as { archivedAt: number }).archivedAt).toBeTypeOf("number");

  const after = await t.api.notes!.list!({});
  const afterNotes = after.data as { id: string }[];
  expect(afterNotes.some((n) => n.id === row.id)).toBe(false);
});

/** Flag-free `app.fetch` must auto-boot. */
test("bare fetch auto-boots the public health route", async () => {
  const res = await app.fetch(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
  expect(app.booted).toBe(true);
  expect(await res.json()).toEqual({ data: { ok: true }, error: null });
});
