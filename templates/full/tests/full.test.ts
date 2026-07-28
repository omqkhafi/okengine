import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("ping chain + AI echo — every element exercised", async () => {
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

  const echoed = await t.api.main.echo({ text: "hi" });
  expect(echoed.error).toBeNull();
  expect(echoed.data).toMatchObject({ ok: true, echo: expect.any(String) });

  const runs = await t.runs();
  expect(runs.some((r) => r.flow === "main.create" && r.error == null)).toBe(
    true,
  );
  expect(runs.some((r) => r.flow === "main.echo" && r.error == null)).toBe(
    true,
  );
  const echoRun = runs.find((r) => r.flow === "main.echo" && r.error == null)!;
  expect(t.effects.of(echoRun.id).some((e) => e.kind === "ask")).toBe(true);

  expect(await t.cron.run("1h")).toBe(true);

  await t.close();
});
