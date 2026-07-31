import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("boots — health flow", async () => {
  const t = await createTestApp(app);
  const { data, error } = await t.api.main.health({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

/** Flag-free `app.fetch` must auto-boot (gate posture + element pipeline). */
test("bare fetch auto-boots the public health route", async () => {
  const res = await app.fetch(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
  expect(app.booted).toBe(true);
  expect(await res.json()).toEqual({ data: { ok: true }, error: null });
});
