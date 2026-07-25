import { test, expect } from "bun:test";
import { createTestApp } from "okengine/test";
import { app } from "../src/app";

test("boots and answers /hello", async () => {
  const t = await createTestApp(app);
  const { data, error } = await t.api.hello.hello({});
  expect(error).toBeNull();
  expect(data?.message).toBe("ok");
});
