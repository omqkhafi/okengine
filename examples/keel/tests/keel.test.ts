import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "@/app";

let t: TestApp<App>;
let admin: Awaited<ReturnType<TestApp<App>["auth"]["loginAs"]>>;

beforeAll(async () => {
  t = await createTestApp(app);
  admin = await t.auth.loginAs({
    id: "aria@keel.dev",
    scopes: [
      "issue:write",
      "team:admin",
      "project:admin",
      "triage:accept",
      "comment:write",
      "files:write",
      "member:admin",
      "webhook:admin",
    ],
  });
  const team = await t.api.teams!.create!({ key: "ENG", name: "Engineering" }, { as: admin });
  expect(team.error).toBeNull();
  const invited = await t.api.members!.invite!(
    { email: "aria@keel.dev", role: "admin" },
    { as: admin },
  );
  expect(invited.error).toBeNull();
});

afterAll(async () => {
  await t.close();
});

test("boots — health flow is named main.health", async () => {
  const { data, error } = await t.api.main!.health!({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

test("github ingest → create → notify", async () => {
  const ingested = await t.api.github!.ingest!(
    { title: "Pulse graph on selected trace", teamKey: "ENG" },
    { as: admin },
  );
  expect(ingested.error).toBeNull();
  const created = ingested.data as { id: string; identifier: string };
  expect(created.identifier).toMatch(/^ENG-\d+$/);

  await t.signals.drain();

  const assigned = await t.api.issues!.assign!(
    { id: created.id, assigneeEmail: "aria@keel.dev" },
    { as: admin },
  );
  expect(assigned.error).toBeNull();

  await t.signals.drain();
  const sent = t.channels.sent();
  expect(sent.some((s) => "template" in s && s.template === "issue-assigned")).toBe(true);
});

test("issues create → list → archive", async () => {
  const created = await t.api.issues!.create!(
    { title: "Archive me", teamKey: "ENG", priority: 3 },
    { as: admin },
  );
  expect(created.error).toBeNull();
  const id = (created.data as { id: string }).id;

  const listed = await t.api.issues!.list!({ q: "Archive" }, { as: admin });
  expect(listed.error).toBeNull();
  const items = (listed.data as { items: { id: string }[] }).items;
  expect(items.some((i) => i.id === id)).toBe(true);

  const archived = await t.api.issues!.archive!({ id }, { as: admin });
  expect(archived.error).toBeNull();
});

test("cycles.close with mocked AI", async () => {
  const cycle = await t.api.cycles!.create!(
    {
      teamId: "team_eng",
      number: 25,
      name: "Cycle 25",
      startsAt: "2026-07-27T00:00:00Z",
      endsAt: "2026-08-09T23:59:59Z",
      state: "active",
    },
    { as: admin },
  );
  expect(cycle.error).toBeNull();

  t.ai.mock("cycle-summary", { summary: "Cycle closed cleanly." });
  await t.cron.run("7d");
  await t.signals.drain();
  expect(t.channels.sent().some((s) => "template" in s && s.template === "cycle-digest")).toBe(
    true,
  );
});
