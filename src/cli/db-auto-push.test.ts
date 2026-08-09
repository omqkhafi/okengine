/**
 * Domain schema watch-path + auto-push policy.
 */

import { describe, expect, test } from "bun:test";
import {
  createDebouncedRunner,
  isDomainSchemaWatchPath,
  resolveDevAutoPush,
} from "./db-auto-push.ts";

describe("isDomainSchemaWatchPath", () => {
  test("matches schema.ts and drizzle.config.ts", () => {
    expect(isDomainSchemaWatchPath("schema.ts")).toBe(true);
    expect(isDomainSchemaWatchPath("drizzle.config.ts")).toBe(true);
    expect(isDomainSchemaWatchPath("flows/notes/schema.ts")).toBe(true);
    expect(isDomainSchemaWatchPath("src/schema.decl.ts")).toBe(true);
  });

  test("ignores emit output (avoids push ↔ generated feedback loop)", () => {
    expect(isDomainSchemaWatchPath("src/db/schema.drizzle.ts")).toBe(false);
    expect(isDomainSchemaWatchPath("schema.drizzle.ts")).toBe(false);
    expect(isDomainSchemaWatchPath("flows/notes/schema.drizzle.tsx")).toBe(false);
    expect(isDomainSchemaWatchPath("src/schema.generated.ts")).toBe(false);
    expect(isDomainSchemaWatchPath("schema.generated.ts")).toBe(false);
    expect(isDomainSchemaWatchPath("flows/notes/schema.generated.tsx")).toBe(false);
  });

  test("ignores unrelated files", () => {
    expect(isDomainSchemaWatchPath("flows/notes/index.ts")).toBe(false);
    expect(isDomainSchemaWatchPath(undefined)).toBe(false);
  });

  test("matches app entry (plugin .table contributions)", () => {
    expect(isDomainSchemaWatchPath("app.ts")).toBe(true);
    expect(isDomainSchemaWatchPath("src/app.ts")).toBe(true);
  });
});

describe("resolveDevAutoPush", () => {
  test("default on", () => {
    expect(resolveDevAutoPush({})).toBe(true);
  });

  test("docker flag ignored (always-compose)", () => {
    expect(resolveDevAutoPush({ docker: true })).toBe(true);
  });

  test("off for --no-db-push", () => {
    expect(resolveDevAutoPush({ noDbPush: true })).toBe(false);
  });

  test("off when config.db.autoPush is false", () => {
    expect(resolveDevAutoPush({ configAutoPush: false })).toBe(false);
  });
});

describe("createDebouncedRunner", () => {
  test("coalesces rapid triggers", async () => {
    let count = 0;
    const runner = createDebouncedRunner(() => {
      count++;
    }, 40);
    runner.trigger();
    runner.trigger();
    runner.trigger();
    expect(count).toBe(0);
    await Bun.sleep(80);
    expect(count).toBe(1);
    runner.cancel();
  });
});
