import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "../src/app";

let t: TestApp<App>;

beforeAll(async () => {
  t = await createTestApp(app);
});

afterAll(async () => {
  await t.close();
});

test("boots — health flow is named main.health", async () => {
  const { data, error } = await t.api.main.health({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

test("notes create → list → archive", async () => {
  const created = await t.api.notes.create({
    title: "Hello",
    body: "World from the standard starter",
  });
  expect(created.error).toBeNull();
  expect(created.data?.title).toBe("Hello");
  expect(created.data?.id).toBeTruthy();

  await t.signals.drain();
  expect(t.channels.sent().some((s) => s.template === "note-created")).toBe(true);

  const listed = await t.api.notes.list({});
  expect(listed.error).toBeNull();
  expect(listed.data?.notes.some((n) => n.id === created.data!.id)).toBe(true);

  const archived = await t.api.notes.archive({ id: created.data!.id });
  expect(archived.error).toBeNull();
  expect(archived.data?.archivedAt).toBeTypeOf("number");

  const after = await t.api.notes.list({});
  expect(after.data?.notes.some((n) => n.id === created.data!.id)).toBe(false);
});

/** Flag-free `app.fetch` must auto-boot. */
test("bare fetch auto-boots the public health route", async () => {
  const res = await app.fetch(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
  expect(app.booted).toBe(true);
  expect(await res.json()).toEqual({ data: { ok: true }, error: null });
});
