import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("order → charge → notify", async () => {
  const t = await createTestApp(app); // memory drivers, frozen clock
  const u = await t.auth.loginAs({ scopes: ["order:create"] });

  const { data } = await t.api.orders.create({ sku: "COFFEE", qty: 2 }, { as: u });
  await t.signals.drain();
  await t.clock.advance("2m"); // the durable sleep elapses instantly
  await t.signals.drain();

  expect(t.channels.sent()).toContainEqual(
    expect.objectContaining({ template: "order-confirmed", to: u.id, locale: "ar" }),
  );
  expect(data?.id).toBeDefined();
  await t.close();
});
