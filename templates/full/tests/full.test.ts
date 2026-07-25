import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("boots — health flow with wired elements", async () => {
  const t = await createTestApp(app);
  const { data, error } = await t.api.main.health({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
  await t.signals.drain();
});
