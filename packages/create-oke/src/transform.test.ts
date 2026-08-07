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

function templateConfig(id: "standard" | "advanced" = "advanced"): string {
  return readFileSync(join(resolveTemplateDir(id), "oke.config.ts"), "utf8");
}

/** Evaluate `oke.config.ts` source via identity `defineConfig` (no okengine import). */
function evalConfig(source: string): {
  drivers?: {
    ai?: unknown;
    channel?: { ai?: unknown; email?: unknown };
  };
  images?: Record<string, string>;
} {
  const body = source
    .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*/m, "")
    .replace(/export\s+default\s+/, "return ");
  const defineConfig = <T>(c: T): T => c;
  return new Function("defineConfig", body)(defineConfig) as ReturnType<typeof evalConfig>;
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
    const next = upsertAiDrivers(templateConfig("advanced"), ollamaPins);
    const config = evalConfig(next);
    expect(config.drivers?.ai).toEqual(ollamaPins);
    expect(config.drivers?.channel?.ai).toBeUndefined();
    expect(config.drivers?.channel?.email).toBeDefined();
  });

  test("applyCreateAnswers with ai pins keeps top-level drivers.ai", () => {
    const llamaPins = pinsDockerReady("openai-compatible", "openai-compatible", "mock");
    for (const id of ["standard", "advanced"] as const) {
      const next = applyCreateAnswers(
        templateConfig(id),
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
            ai: llamaPins,
          },
          ai: { enabled: true, provider: "llama-cpp", driver: "openai-compatible" },
        }),
      );
      const config = evalConfig(next);
      expect(config.drivers?.ai, id).toEqual({
        local: "openai-compatible",
        docker: "openai-compatible",
        test: "mock",
        prod: "openai-compatible",
      });
      expect(config.drivers?.channel?.ai, id).toBeUndefined();
      expect(config.images?.ai, id).toBe("ghcr.io/ggml-org/llama.cpp:server-b10290");
    }
  });
});
