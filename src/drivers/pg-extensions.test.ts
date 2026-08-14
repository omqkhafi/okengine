import { describe, expect, test } from "bun:test";
import {
  isPgExtensionVersion,
  PG_ALL_EXTENSIONS,
  pgExtensionUrl,
  pgExtensionVersionNewer,
} from "./pg-extensions.ts";

describe("pgExtensionVersionNewer", () => {
  test("detects a newer dotted version", () => {
    expect(pgExtensionVersionNewer("1.4", "1.3")).toBe(true);
    expect(pgExtensionVersionNewer("1.11", "1.10")).toBe(true);
    expect(pgExtensionVersionNewer("2.0", "1.9")).toBe(true);
  });

  test("same or older is not newer", () => {
    expect(pgExtensionVersionNewer("1.4", "1.4")).toBe(false);
    expect(pgExtensionVersionNewer("1.3", "1.4")).toBe(false);
  });
});

describe("pgExtensionUrl", () => {
  test("pgvector points at the project repo", () => {
    expect(pgExtensionUrl("vector")).toBe("https://github.com/pgvector/pgvector");
  });

  test("contrib packs point at Postgres docs", () => {
    expect(pgExtensionUrl("amcheck")).toBe("https://www.postgresql.org/docs/current/amcheck.html");
  });

  test("every catalog extension has a homepage", () => {
    for (const ext of PG_ALL_EXTENSIONS) {
      expect(pgExtensionUrl(ext.name), ext.name).toBeTruthy();
    }
  });
});

describe("isPgExtensionVersion", () => {
  test("accepts dotted numeric versions", () => {
    expect(isPgExtensionVersion("1")).toBe(true);
    expect(isPgExtensionVersion("1.4")).toBe(true);
    expect(isPgExtensionVersion("1.10")).toBe(true);
  });

  test("rejects other tokens", () => {
    expect(isPgExtensionVersion("")).toBe(false);
    expect(isPgExtensionVersion("latest")).toBe(false);
    expect(isPgExtensionVersion("1.4; drop")).toBe(false);
  });
});
