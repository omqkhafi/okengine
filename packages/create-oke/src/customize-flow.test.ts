/**
 * Unit tests for local|docker customize assembly (no Clack prompts).
 */

import { describe, expect, test } from "bun:test";
import {
  EMAIL_CHOICES,
  INDEX_CHOICES,
  TEMPLATE_DOCKER_PROD,
  TEMPLATE_LOCAL,
  customizeFacetsFor,
} from "./drivers-catalog.ts";
import { assembleDriverDefaults, pinsFromSides, recommendedAiApply } from "./customize-flow.ts";

describe("customizeFacetsFor", () => {
  test("standard is lean (sql only)", () => {
    expect(customizeFacetsFor("standard")).toEqual(["sql"]);
  });

  test("advanced walks the full facet list", () => {
    expect(customizeFacetsFor("advanced")).toEqual([
      "sql",
      "kv",
      "files",
      "index",
      "signal",
      "clock",
      "vault",
      "email",
    ]);
  });
});

describe("catalog labels", () => {
  test("store.index offers none before drivers", () => {
    expect(INDEX_CHOICES.map((c) => c.value)).toEqual([
      "none",
      "memory",
      "pgvector",
      "libsql",
      "meilisearch",
    ]);
  });

  test("channel.email labels taqnyat-mail as taqnyat", () => {
    const row = EMAIL_CHOICES.find((c) => c.value === "taqnyat-mail");
    expect(row?.label).toBe("taqnyat");
  });
});

describe("recommendedAiApply", () => {
  test("returns llama.cpp (openai-compatible) with curated ai/ model", () => {
    const apply = recommendedAiApply();
    expect(apply.driver).toBe("openai-compatible");
    expect(apply.chatModel).toBe("smollm2");
    expect(apply.baseUrl).toContain("8080");
    expect(apply.image).toContain("llama.cpp");
    expect(apply.image).not.toContain("latest");
    expect(apply.visionModel).toBeNull();
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
  test("primary docker + skip other → local pins === template defaults", () => {
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

  test("index stays null for none / unset", () => {
    expect(assembleDriverDefaults("local", { sql: "sqlite" }, null).store.index).toBeNull();
    expect(assembleDriverDefaults("docker", { index: "none" }, null).store.index).toBeNull();
  });

  test("index driver on primary fills both columns", () => {
    const drivers = assembleDriverDefaults("docker", { index: "meilisearch" }, null);
    expect(drivers.store.index).toEqual({
      local: "memory",
      docker: "meilisearch",
      test: "memory",
      prod: "meilisearch",
    });
  });
});
