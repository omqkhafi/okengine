/**
 * Unit tests for local|docker customize assembly (no Clack prompts).
 */

import { describe, expect, test } from "bun:test";
import { TEMPLATE_DOCKER_PROD, TEMPLATE_LOCAL, customizeFacetsFor } from "./drivers-catalog.ts";
import { assembleDriverDefaults, pinsFromSides } from "./customize-flow.ts";

describe("customizeFacetsFor", () => {
  test("standard is lean (sql only)", () => {
    expect(customizeFacetsFor("standard")).toEqual(["sql"]);
  });

  test("advanced walks the full facet list", () => {
    expect(customizeFacetsFor("advanced")).toEqual([
      "sql",
      "kv",
      "files",
      "enableIndex",
      "index",
      "signal",
      "clock",
      "vault",
      "email",
    ]);
  });
});

describe("pinsFromSides", () => {
  test("prod copies docker", () => {
    expect(pinsFromSides("sqlite", "postgres", "memory")).toEqual({
      local: "sqlite",
      docker: "postgres",
      test: "memory",
      prod: "postgres",
    });
  });
});

describe("assembleDriverDefaults", () => {
  test("primary docker + decline other → local pins === template defaults", () => {
    const drivers = assembleDriverDefaults(
      "docker",
      { sql: "libsql", kv: "redis", files: "s3", signal: "nats" },
      null,
    );
    expect(drivers.store.sql.docker).toBe("libsql");
    expect(drivers.store.sql.local).toBe(TEMPLATE_LOCAL.sql);
    expect(drivers.store.kv.local).toBe(TEMPLATE_LOCAL.kv);
    expect(drivers.signal.local).toBe(TEMPLATE_LOCAL.signal);
    expect(drivers.store.sql.prod).toBe("libsql");
  });

  test("primary local + customize docker → both sides set", () => {
    const drivers = assembleDriverDefaults("local", { sql: "pglite" }, { sql: "postgres" });
    expect(drivers.store.sql.local).toBe("pglite");
    expect(drivers.store.sql.docker).toBe("postgres");
    expect(drivers.store.sql.prod).toBe("postgres");
    // Unpicked facets fall back to catalog defaults.
    expect(drivers.store.kv.local).toBe(TEMPLATE_LOCAL.kv);
    expect(drivers.store.kv.docker).toBe(TEMPLATE_DOCKER_PROD.kv);
  });

  test("index stays null unless enableIndex", () => {
    const drivers = assembleDriverDefaults("local", { sql: "sqlite" }, null);
    expect(drivers.store.index).toBeNull();
  });

  test("enableIndex on primary fills both columns", () => {
    const drivers = assembleDriverDefaults(
      "docker",
      { enableIndex: true, index: "meilisearch" },
      null,
    );
    expect(drivers.store.index).toEqual({
      local: "memory",
      docker: "meilisearch",
      test: "memory",
      prod: "meilisearch",
    });
  });
});
