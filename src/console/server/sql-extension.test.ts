import { describe, expect, test } from "bun:test";
import { buildCreateExtensionSql } from "./sql-catalog.ts";

describe("buildCreateExtensionSql", () => {
  test("emits SCHEMA, VERSION, and CASCADE", () => {
    expect(
      buildCreateExtensionSql("pg_cron", { schema: "ext", version: "1.6", cascade: true }),
    ).toBe('CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "ext" VERSION \'1.6\' CASCADE');
  });

  test("refuses pg_catalog and bad versions", () => {
    expect(() => buildCreateExtensionSql("pg_cron", { schema: "pg_catalog" })).toThrow(
      "invalid extension schema",
    );
    expect(() => buildCreateExtensionSql("pg_cron", { version: "latest" })).toThrow(
      "invalid extension version",
    );
  });
});
