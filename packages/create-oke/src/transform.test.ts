/**
 * create-oke config transforms — images must stay role→image pins.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toCreateDefaults } from "./create-defaults.ts";
import { pinsDockerReady, pinsLocalOnly } from "./drivers-catalog.ts";
import { resolveTemplateDir } from "./templates.ts";
import { applyCreateAnswers, upsertAiDrivers } from "./transform.ts";
import type { EnvDriverPins } from "./create-defaults.ts";

function templateConfig(): string {
  return readFileSync(join(resolveTemplateDir("standard"), "oke.config.ts"), "utf8");
}

function defaultsWithIndex(indexLocal: string, indexDocker: string) {
  return toCreateDefaults({
    template: "advanced",
    profile: "docker-ready",
    drivers: {
      store: {
        sql: pinsDockerReady("libsql", "postgres", "memory"),
        kv: pinsLocalOnly("memory", "redis", "memory"),
        files: pinsLocalOnly("fs", "s3", "memory"),
        index: pinsDockerReady(indexLocal, indexDocker, "memory"),
      },
      signal: pinsLocalOnly("memory", "redis", "memory"),
      clock: pinsLocalOnly("memory", "file", "frozen"),
      vault: pinsLocalOnly("env", "openbao", "memory"),
      channel: { email: pinsLocalOnly("console", "smtp", "console") },
      ai: null,
    },
    ai: { enabled: false, provider: null, driver: null },
  });
}

describe("applyCreateAnswers images", () => {
  test("index: libsql does not poison images with driver pins", () => {
    const next = applyCreateAnswers(templateConfig(), defaultsWithIndex("libsql", "libsql"));
    expect(next).toContain('local: "libsql"');
    expect(next).toMatch(/index:\s*\{\s*local: "libsql"/);
    // Role pins only — never env-column keys or bare driver ids as images.
    expect(next).not.toMatch(/images:\s*\{[^}]*\blocal:\s*"/s);
    expect(next).not.toMatch(/images:\s*\{[^}]*\bdocker:\s*"/s);
    expect(next).not.toMatch(/images:\s*\{[^}]*:\s*"libsql"/s);
    expect(next).toContain('"store.sql": "postgres:18-alpine"');
  });

  test("index meilisearch pins store.index image without comment leakage", () => {
    const next = applyCreateAnswers(
      templateConfig(),
      defaultsWithIndex("meilisearch", "meilisearch"),
    );
    expect(next).toContain('"store.index": "getmeili/meilisearch:v1.37"');
    expect(next).not.toMatch(/images:\s*\{[^}]*\btest:\s*"memory"/s);
  });
});

describe("upsertAiDrivers", () => {
  const ollamaPins: EnvDriverPins = {
    local: "ollama",
    docker: "ollama",
    test: "mock",
    prod: "ollama",
  };

  test("inserts drivers.ai as sibling of channel (not inside email)", () => {
    const next = upsertAiDrivers(templateConfig(), ollamaPins);
    expect(next).toMatch(/^ {4}ai:\s*\{/m);
    expect(next).toContain('local: "ollama"');
    const channel = next.match(/^ {4}channel:\s*\{[\s\S]*?\n {4}\},?\n/m)?.[0] ?? "";
    expect(channel).toContain("email:");
    expect(channel).not.toContain("ai:");
  });

  test("applyCreateAnswers with ai pins keeps top-level drivers.ai", () => {
    const next = applyCreateAnswers(
      templateConfig(),
      toCreateDefaults({
        template: "advanced",
        profile: "docker-ready",
        drivers: {
          store: {
            sql: pinsDockerReady("libsql", "postgres", "memory"),
            kv: pinsLocalOnly("memory", "redis", "memory"),
            files: pinsLocalOnly("fs", "s3", "memory"),
            index: null,
          },
          signal: pinsLocalOnly("memory", "redis", "memory"),
          clock: pinsLocalOnly("memory", "file", "frozen"),
          vault: pinsLocalOnly("env", "openbao", "memory"),
          channel: { email: pinsLocalOnly("console", "smtp", "console") },
          ai: ollamaPins,
        },
        ai: { enabled: true, provider: "ollama", driver: "ollama" },
      }),
    );
    expect(next).toMatch(/^ {4}ai:\s*\{/m);
    expect(next).toContain('ai: "ollama/ollama:latest"');
    const channel = next.match(/^ {4}channel:\s*\{[\s\S]*?\n {4}\},?\n/m)?.[0] ?? "";
    expect(channel).not.toContain("ai:");
  });
});
