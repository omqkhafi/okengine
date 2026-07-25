import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("create then read", async () => {
  const t = await createTestApp(app);            // memory driver, automatic
  const { data } = await t.api.notes.create({ title: "First", body: "Hello" });
  const { data: note } = await t.api.notes.get({ id: data!.id });
  expect(note!.title).toBe("First");
});
