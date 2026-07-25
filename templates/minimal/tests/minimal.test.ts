import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("boots — create then list", async () => {
  const t = await createTestApp(app);
  const { data, error } = await t.api.main.create({ body: "hello" });
  expect(error).toBeNull();
  expect(data?.id).toBeTruthy();
  const { data: rows } = await t.api.main.list({});
  expect(rows?.length).toBe(1);
  expect(rows?.[0]?.body).toBe("hello");
});
