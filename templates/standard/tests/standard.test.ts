import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("ping chain — store · gate · vault · signal · channel · clock", async () => {
  const t = await createTestApp(app);

  const created = await t.api.main.create({ note: "hello" });
  expect(created.error).toBeNull();
  expect(created.data).toMatchObject({ id: expect.any(String) });

  await t.signals.drain();

  const listed = await t.api.main.list({});
  expect(listed.error).toBeNull();
  expect(listed.data).toEqual([
    expect.objectContaining({ id: created.data!.id, note: "hello" }),
  ]);

  const sent = t.channels.sent();
  expect(sent.length).toBeGreaterThanOrEqual(1);
  expect(
    sent.some((s) => "template" in s && s.template === "ping-notice"),
  ).toBe(true);

  const runs = await t.runs();
  const createRun = runs.find((r) => r.flow === "main.create" && r.error == null);
  expect(createRun).toBeDefined();
  expect(createRun!.gates.length).toBeGreaterThan(0);
  expect(
    t.effects.of(createRun!.id).some((e) => e.kind === "secret"),
  ).toBe(true);
  expect(
    t.effects.of(createRun!.id).some((e) => e.kind === "emit"),
  ).toBe(true);

  expect(await t.cron.run("1h")).toBe(true);

  const health = await t.api.main.health({});
  expect(health.error).toBeNull();
  expect(health.data).toEqual({ ok: true });

  await t.close();
});
