import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "@/app";

let t: TestApp<App>;

beforeAll(async () => {
  t = await createTestApp(app);
}, 30_000);

afterAll(async () => {
  await t.close();
});

test("boots — health flow is named main.health", async () => {
  const { data, error } = await t.api.main!.health!({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

test("welcome route names the app and first-run paths", async () => {
  const { data, error } = await t.api.main!.root!({});
  expect(error).toBeNull();
  expect(data).toEqual({
    ok: true,
    app: "app",
    try: ["GET /health"],
    console: "http://127.0.0.1:6533",
  });
});

/** Flag-free `app.fetch` must auto-boot. */
test("bare fetch auto-boots the public health route", async () => {
  const res = await app.fetch(new Request("http://localhost/health"));
  expect(res.status).toBe(200);
  expect(app.booted).toBe(true);
  expect(await res.json()).toEqual({ data: { ok: true }, error: null });
});
