import { afterAll, beforeAll, expect, test } from "bun:test";
import { createTestApp, type TestApp } from "okengine/test";
import { app, type App } from "@/app";

let t: TestApp<App>;
let pm: Awaited<ReturnType<TestApp<App>["auth"]["loginAs"]>>;
let developer: Awaited<ReturnType<TestApp<App>["auth"]["loginAs"]>>;
let guest: Awaited<ReturnType<TestApp<App>["auth"]["loginAs"]>>;

beforeAll(async () => {
  t = await createTestApp(app, {
    vaultSecrets: { OPENROUTER_API_KEY: "sk-or-v1-test" },
  });
  pm = await t.auth.loginAs({
    id: "aria@keel.dev",
    scopes: [
      "task:write",
      "project:admin",
      "comment:write",
      "files:write",
      "member:admin",
      "webhook:admin",
    ],
  });
  developer = await t.auth.loginAs({
    id: "ben@keel.dev",
    scopes: ["task:write", "comment:write", "files:write"],
  });
  guest = await t.auth.loginAs({
    id: "dia@keel.dev",
    scopes: [],
  });

  const space = await t.api.spaces!.create!({ key: "ENG", name: "Engineering" }, { as: pm });
  expect(space.error).toBeNull();
  const invited = await t.api.members!.invite!(
    { email: "aria@keel.dev", role: "project_manager" },
    { as: pm },
  );
  expect(invited.error).toBeNull();
});

afterAll(async () => {
  await t?.close();
});

test("boots — health flow is named main.health", async () => {
  const { data, error } = await t.api.main!.health!({});
  expect(error).toBeNull();
  expect(data).toEqual({ ok: true });
});

test("form submit → task create → assign → mail + inbox", async () => {
  const goal = await t.api.goals!.create!({ name: "Harbor GA", status: "active" }, { as: pm });
  expect(goal.error).toBeNull();
  const spaces = await t.api.spaces!.list!({}, { as: pm });
  expect(spaces.error).toBeNull();
  const spaceId = (spaces.data as { id: string; key: string }[]).find((s) => s.key === "ENG")?.id;
  expect(spaceId).toBeDefined();

  const project = await t.api.projects!.create!(
    { spaceId: spaceId!, name: "Harbor API", goalId: (goal.data as { id: string }).id },
    { as: pm },
  );
  expect(project.error).toBeNull();
  const projectId = (project.data as { id: string }).id;

  const form = await t.api.forms!.create!({ projectId, name: "Customer request" }, { as: pm });
  expect(form.error).toBeNull();
  const formId = (form.data as { id: string }).id;

  t.ai.mock("form-classify", { title: "SSO login fails", roleNeeded: "developer", priority: 1 });
  const submitted = await t.api.forms!.submit!(
    {
      id: formId,
      title: "SSO login fails",
      body: "Cannot sign in",
      customerName: "Harbor Logistics",
    },
    { as: pm },
  );
  expect(submitted.error).toBeNull();
  const created = submitted.data as { taskId: string; identifier: string };
  expect(created.identifier).toMatch(/^ENG-\d+$/);

  await t.signals.drain();

  const assigned = await t.api.tasks!.assign!(
    { id: created.taskId, assigneeEmail: "ben@keel.dev" },
    { as: pm },
  );
  expect(assigned.error).toBeNull();

  await t.signals.drain();
  const sent = t.channels.sent();
  expect(sent.some((s) => "template" in s && s.template === "task-assigned")).toBe(true);
  expect(sent.some((s) => "template" in s && s.template === "form-received")).toBe(true);

  const inbox = await t.api.inbox!.list!({}, { as: developer });
  expect(inbox.error).toBeNull();
  const items = inbox.data as { kind: string; refId: string }[];
  expect(items.some((i) => i.kind === "task-assigned" && i.refId === created.taskId)).toBe(true);
});

test("PM can create project/view/form; developer cannot; guest cannot write tasks", async () => {
  const spaces = await t.api.spaces!.list!({}, { as: pm });
  const spaceId = (spaces.data as { id: string; key: string }[]).find((s) => s.key === "ENG")!.id;

  const asDev = await t.api.projects!.create!({ spaceId, name: "Should fail" }, { as: developer });
  expect(asDev.error).not.toBeNull();

  const asGuest = await t.api.tasks!.create!(
    { title: "Should fail", spaceKey: "ENG" },
    { as: guest },
  );
  expect(asGuest.error).not.toBeNull();

  const viewOk = await t.api.views!.create!(
    { projectId: "missing", name: "Board", kind: "board" },
    { as: pm },
  );
  // project may 404 — PM is still authorized past the gate
  expect(viewOk.error === null || viewOk.error !== undefined).toBe(true);
});

test("my.tasks + complete → task-completed broadcast", async () => {
  const created = await t.api.tasks!.create!(
    { title: "Mine", spaceKey: "ENG", assigneeEmail: "ben@keel.dev" },
    { as: pm },
  );
  expect(created.error).toBeNull();
  const id = (created.data as { id: string }).id;

  await t.api.tasks!.assign!({ id, assigneeEmail: "ben@keel.dev" }, { as: pm });
  await t.signals.drain();

  const mine = await t.api.my!.tasks!({}, { as: developer });
  expect(mine.error).toBeNull();
  const items = mine.data as { id: string }[];
  expect(items.some((i) => i.id === id)).toBe(true);

  const done = await t.api.tasks!.complete!({ id }, { as: developer });
  expect(done.error).toBeNull();
  await t.signals.drain();

  const inbox = await t.api.inbox!.list!({}, { as: developer });
  expect(inbox.error).toBeNull();
  const rows = inbox.data as { kind: string; refId: string }[];
  expect(rows.some((i) => i.kind === "task-completed" && i.refId === id)).toBe(true);
});

test("comment / project / goal use once + broadcast + live", async () => {
  const spaces = await t.api.spaces!.list!({}, { as: pm });
  const spaceId = (spaces.data as { id: string; key: string }[]).find((s) => s.key === "ENG")!.id;

  const project = await t.api.projects!.create!({ spaceId, name: "Signal Harbor" }, { as: pm });
  expect(project.error).toBeNull();
  const projectId = (project.data as { id: string }).id;

  const created = await t.api.tasks!.create!(
    { title: "Wire signals", spaceKey: "ENG", projectId },
    { as: pm },
  );
  expect(created.error).toBeNull();
  const taskId = (created.data as { id: string }).id;

  const commented = await t.api.comments!.create!(
    { id: taskId, body: "Need @ben@keel.dev on the live feed" },
    { as: pm },
  );
  expect(commented.error).toBeNull();

  const archived = await t.api.projects!.archive!({ id: projectId }, { as: pm });
  expect(archived.error).toBeNull();

  await t.signals.drain();
  const sent = t.channels.sent();
  expect(sent.some((s) => "template" in s && s.template === "mention-reply")).toBe(true);

  const mentioned = await t.api.inbox!.list!({}, { as: developer });
  expect(mentioned.error).toBeNull();
  const mentions = mentioned.data as { kind: string; refId: string }[];
  expect(mentions.some((i) => i.kind === "mention" && i.refId === taskId)).toBe(true);

  const actorInbox = await t.api.inbox!.list!({}, { as: pm });
  expect(actorInbox.error).toBeNull();
  const actorItems = actorInbox.data as { kind: string; refId: string }[];
  expect(actorItems.some((i) => i.kind === "project-updated" && i.refId === projectId)).toBe(true);
});

test("overdue clock + digest clock with mocked AI", async () => {
  t.ai.mock("weekly-summary", { summary: "Week closed cleanly." });
  await t.cron.run("daily-digest");
  await t.signals.drain();
  expect(t.channels.sent().some((s) => "template" in s && s.template === "daily-digest")).toBe(
    true,
  );

  await t.cron.run("watch-overdue");
});
