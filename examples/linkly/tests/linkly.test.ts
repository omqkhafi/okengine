import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("shorten → redirect → report · time travel", async () => {
  const t = await createTestApp(app); // memory drivers, frozen clock
  const u = await t.auth.loginAs({});

  await t.api.links.shorten({ url: "https://example.com", code: "sa" }, { as: u });
  await t.api.links.redirect({ code: "sa" });
  await t.signals.drain(); // run queued work deterministically

  const { data } = await t.api.links.report({ code: "sa" }, { as: u });
  expect(data![0].clicks).toBe(1);

  await t.clock.advance("31d");
  await t.cron.run("1h"); // time travel
  await t.close();
});
