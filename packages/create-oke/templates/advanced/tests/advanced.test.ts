import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "@/app";

let t: TestApp<App>;

beforeAll(async () => {
  t = await createTestApp(app, {
    boot: {
      config: {
        drivers: {
          store: { sql: { test: "pglite" } },
        },
      },
    },
  });
});

afterAll(async () => {
  await t.close();
});

test("boots — health flow is named main.health", async () => {
  const { data, error } = await t.api.main!.health!({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

test("notes create → attach → archive", async () => {
  const created = await t.api.notes!.create!({
    title: "Advanced",
    body: "Body long enough to exercise attach and summarize paths in the advanced starter.",
  });
  expect(created.error).toBeNull();
  const id = (created.data as { id: string }).id;

  await t.signals.drain();

  const attached = await t.api.notes!.attach!({ id, text: "attachment body" });
  expect(attached.error).toBeNull();
  expect((attached.data as { key: string }).key).toBe(`notes/${id}/attachment.txt`);

  // `notes.summarize` needs `oke ai setup` (summarize-note prompt) — exercised there.

  const archived = await t.api.notes!.archive!({ id });
  expect(archived.error).toBeNull();
});
