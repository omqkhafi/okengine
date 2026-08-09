/**
 * Unit tests for Docker-first customize assembly (no Clack prompts).
 */

import { describe, expect, test } from "bun:test";
import {
  EMAIL_CHOICES,
  INDEX_CHOICES,
  TEMPLATE_DEV,
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
    expect(apply.chatModel).toBe("granite3.3:2b");
    expect(apply.baseUrl).toContain("8080");
    expect(apply.image).toContain("llama.cpp");
    expect(apply.image).not.toContain("latest");
    expect(apply.visionModel).toBeNull();
  });
});

describe("pinsFromSides", () => {
  test("prod mirrors dev by default", () => {
    expect(pinsFromSides("postgres", "pglite")).toEqual({
      dev: "postgres",
      test: "pglite",
      prod: "postgres",
    });
  });
});

describe("assembleDriverDefaults", () => {
  test("picked sql + defaults for unpicked facets", () => {
    const drivers = assembleDriverDefaults({
      sql: "postgres",
      kv: "redis",
      files: "s3",
      signal: "redis",
    });
    expect(drivers.store.sql.dev).toBe("postgres");
    expect(drivers.store.sql.test).toBe("pglite");
    expect(drivers.store.sql.prod).toBe("postgres");
    expect(drivers.store.kv.dev).toBe("redis");
    expect(drivers.signal.dev).toBe("redis");
    expect(drivers.vault.dev).toBe(TEMPLATE_DEV.vault);
  });

  test("empty pick → template Docker-first defaults", () => {
    const drivers = assembleDriverDefaults({});
    expect(drivers.store.sql.dev).toBe(TEMPLATE_DEV.sql);
    expect(drivers.store.kv.dev).toBe(TEMPLATE_DEV.kv);
    expect(drivers.store.sql.test).toBe("pglite");
  });

  test("index stays null for none / unset", () => {
    expect(assembleDriverDefaults({ sql: "postgres" }).store.index).toBeNull();
    expect(assembleDriverDefaults({ index: "none" }).store.index).toBeNull();
  });

  test("index driver fills both runtime columns", () => {
    const drivers = assembleDriverDefaults({ index: "meilisearch" });
    expect(drivers.store.index).toEqual({
      dev: "meilisearch",
      test: "memory",
      prod: "meilisearch",
    });
  });
});
