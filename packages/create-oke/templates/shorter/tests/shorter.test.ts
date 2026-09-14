import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "@/app";

process.env.OKE_PGLITE_URL ??= "memory://";

let t: TestApp<App>;

beforeAll(async () => {
  t = await createTestApp(app, {
    vaultSecrets: {
      OKE_CHANNEL_EMAIL_URL: "smtp://127.0.0.1:1025",
      SMTP_URL: "smtp://127.0.0.1:1025",
      OKE_STORE_FILES_URL: "s3://127.0.0.1/oke",
      OKE_STORE_KV_URL: "redis://127.0.0.1:6379",
      REDIS_URL: "redis://127.0.0.1:6379",
    },
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

test("welcome route names the app and first-run paths", async () => {
  const { data, error } = await t.api.main!.root!({});
  expect(error).toBeNull();
  expect(data).toEqual({
    ok: true,
    app: "shorter",
    try: ["POST /links", "GET /:code", "GET /health"],
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

test("unauthenticated create is 401", async () => {
  const created = await t.api.links!.create!({ url: "https://oke.omqkhafi.dev" });
  expect(created.error?.code).toBe("Unauthorized");
});

test("create → list (own only) → 302 public → drain → clicks; other user Forbidden", async () => {
  const owner = await t.auth.loginAs({ id: "usr_1" });
  const other = await t.auth.loginAs({ id: "usr_2" });

  const created = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev/docs", code: "docs" },
    { as: owner },
  );
  expect(created.error).toBeNull();
  const row = created.data as { id: string; code: string; url: string; userId: string };
  expect(row.code).toBe("docs");
  expect(row.userId).toBe("usr_1");

  await t.signals.drain();
  expect(t.channels.sent().some((s) => s.template === "link-created")).toBe(true);

  const listed = await t.api.links!.list!({}, { as: owner });
  expect(listed.error).toBeNull();
  const mine = listed.data as { code: string }[];
  expect(mine.some((n) => n.code === "docs")).toBe(true);

  const strangerList = await t.api.links!.list!({}, { as: other });
  expect(strangerList.error).toBeNull();
  const theirs = strangerList.data as { code: string }[];
  expect(theirs.some((n) => n.code === "docs")).toBe(false);

  const stolen = await t.api.links!.get!({ code: "docs" }, { as: other });
  expect(stolen.error?.code).toBe("Forbidden");

  const res = await app.fetch(new Request("http://localhost/docs", { redirect: "manual" }));
  expect(res.status).toBe(302);
  expect(res.headers.get("Location")).toBe("https://oke.omqkhafi.dev/docs");

  await t.signals.drain();
  const afterClick = await t.api.links!.get!({ code: "docs" }, { as: owner });
  expect(afterClick.error).toBeNull();
  expect((afterClick.data as { clicks: number }).clicks).toBe(1);

  const report = await t.api.links!.report!({ code: "docs" }, { as: owner });
  expect(report.error).toBeNull();
  expect((report.data as { clicks: number }).clicks).toBe(1);

  const stolenReport = await t.api.links!.report!({ code: "docs" }, { as: other });
  expect(stolenReport.error?.code).toBe("Forbidden");
});

test("archive owner-checked; missing code fails", async () => {
  const owner = await t.auth.loginAs({ id: "usr_1" });
  const other = await t.auth.loginAs({ id: "usr_2" });

  const created = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev", code: "oke" },
    { as: owner },
  );
  expect(created.error).toBeNull();

  const stolen = await t.api.links!.archive!({ code: "oke" }, { as: other });
  expect(stolen.error?.code).toBe("Forbidden");

  const archived = await t.api.links!.archive!({ code: "oke" }, { as: owner });
  expect(archived.error).toBeNull();
  expect((archived.data as { archivedAt: string | null }).archivedAt).toBeTypeOf("string");

  const gone = await app.fetch(new Request("http://localhost/oke", { redirect: "manual" }));
  expect(gone.status).not.toBe(302);

  const missing = await t.api.links!.get!({ code: "nope" }, { as: owner });
  expect(missing.error?.code).toBe("NotFound");
});

test("Reach digest after clock advance", async () => {
  const owner = await t.auth.loginAs({ id: "usr_1" });
  const created = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev/reach", code: "rch" },
    { as: owner },
  );
  expect(created.error).toBeNull();

  const hit = await app.fetch(new Request("http://localhost/rch", { redirect: "manual" }));
  expect(hit.status).toBe(302);
  await t.signals.drain();

  const now = t.clock.now();
  const utc = new Date(now);
  const nextNine = Date.UTC(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate() + 1, 9, 0, 0);
  await t.clock.advance(nextNine - now);
  expect(await t.cron.run("links.reach")).toBe(true);
  expect(t.channels.sent().some((s) => s.template === "reach-digest")).toBe(true);
});

test("expire archives past expiresAt", async () => {
  const owner = await t.auth.loginAs({ id: "usr_1" });
  const expiresAt = new Date(t.clock.now() + 60 * 60 * 1000).toISOString();
  const created = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev/exp", code: "exp", expiresAt },
    { as: owner },
  );
  expect(created.error).toBeNull();

  await t.clock.advance("2h");
  expect(await t.cron.run("links.expire")).toBe(true);

  const got = await t.api.links!.get!({ code: "exp" }, { as: owner });
  expect(got.error).toBeNull();
  expect((got.data as { archivedAt: string | null }).archivedAt).toBeTypeOf("string");

  const gone = await app.fetch(new Request("http://localhost/exp", { redirect: "manual" }));
  expect(gone.status).not.toBe(302);
});

test("create rejects non-http urls, reserved aliases, and duplicates", async () => {
  const owner = await t.auth.loginAs({ id: "usr_1" });

  const invalid = await t.api.links!.create!(
    { url: "ftp://oke.omqkhafi.dev" },
    { as: owner },
  );
  expect(invalid.error?.code).toBe("InvalidUrl");

  const reserved = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev", code: "health" },
    { as: owner },
  );
  expect(reserved.error?.code).toBe("Conflict");

  const first = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev/dup", code: "dup" },
    { as: owner },
  );
  expect(first.error).toBeNull();

  const again = await t.api.links!.create!(
    { url: "https://oke.omqkhafi.dev/dup", code: "dup" },
    { as: owner },
  );
  expect(again.error?.code).toBe("Conflict");
});

test("unknown public code is not a 302", async () => {
  const res = await app.fetch(new Request("http://localhost/no-such", { redirect: "manual" }));
  expect(res.status).not.toBe(302);
});
