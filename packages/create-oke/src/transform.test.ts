/**
 * create-oke config transforms — images must stay role→image pins.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { toCreateDefaults } from "./create-defaults.ts";
import { pinsDockerReady, recommendedDefaults, VAULT_CHOICES } from "./drivers-catalog.ts";
import { resolveTemplateDir } from "./templates.ts";
import { applyCreateAnswers, extractImages, upsertAiDrivers } from "./transform.ts";
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
  images?: {
    store?: Record<string, string>;
    channel?: Record<string, string>;
    ai?: string;
  };
} {
  const body = source
    .replace(/^import\s+[\s\S]*?from\s+["'][^"']+["'];?\s*/m, "")
    .replace(/export\s+default\s+/, "return ");
  const defineConfig = <T>(c: T): T => c;
  return new Function("defineConfig", body)(defineConfig) as ReturnType<typeof evalConfig>;
}

function defaultsWithIndex(indexDev: string) {
  return toCreateDefaults({
    template: "advanced",
    profile: "docker-ready",
    drivers: {
      store: {
        sql: pinsDockerReady("postgres", "pglite"),
        kv: pinsDockerReady("redis", "memory"),
        files: pinsDockerReady("s3", "memory"),
        index: pinsDockerReady(indexDev, "memory"),
      },
      signal: pinsDockerReady("redis", "memory"),
      clock: pinsDockerReady("postgres", "frozen"),
      vault: pinsDockerReady("vault", "memory"),
      channel: { email: pinsDockerReady("smtp", "console") },
      ai: null,
    },
    ai: { enabled: false, provider: null, driver: null },
    locales: [],
    pgdog: false,
    proxy: "none",
  });
}

describe("applyCreateAnswers images", () => {
  test("index: pgvector does not poison images with driver pins", () => {
    const next = applyCreateAnswers(templateConfig(), defaultsWithIndex("pgvector"));
    expect(next).toContain('dev: "pgvector"');
    expect(next).toMatch(/index:\s*\{\s*dev: "pgvector"/);
    // Role pins only — never env-column keys or bare driver ids as images.
    expect(next).not.toMatch(/images:\s*\{[^}]*\bdev:\s*"/s);
    expect(next).not.toMatch(/images:\s*\{[^}]*\btest:\s*"memory"/s);
    expect(next).not.toMatch(/images:\s*\{[^}]*:\s*"pgvector"/s);
    expect(next).toMatch(/images:\s*\{\s*store:\s*\{[^}]*\bsql: "postgres:18-alpine"/s);
  });

  test("index meilisearch pins store.index image without comment leakage", () => {
    const next = applyCreateAnswers(templateConfig(), defaultsWithIndex("meilisearch"));
    expect(next).toMatch(/images:\s*\{\s*store:\s*\{[^}]*\bindex: "getmeili\/meilisearch:v1.53"/s);
    expect(next).not.toMatch(/images:\s*\{[^}]*\btest:\s*"memory"/s);
  });
});

describe("vault backend defaults", () => {
  test("recommended defaults pick the built-in encrypted store", () => {
    const defaults = recommendedDefaults("docker-ready", "standard");
    expect(defaults.drivers.vault).toEqual({ dev: "vault", test: "memory", prod: "vault" });
  });

  test("the wizard offers env, vault, managed, and memory", () => {
    const values = VAULT_CHOICES.map((c) => c.value);
    expect(values).toEqual(["env", "vault", "managed", "memory"]);
    expect(VAULT_CHOICES.find((c) => c.value === "vault")?.label).toContain("recommended");
  });

  test("both templates pin only vault.dev (built-in) — other drivers use defaults", () => {
    for (const id of ["standard", "advanced"] as const) {
      const source = templateConfig(id);
      expect(source, id).toMatch(/vault:\s*\{\s*dev: "vault",?\s*\}/);
      expect(source, id).not.toMatch(/^\s*sql:\s*\{/m);
      expect(source, id).not.toMatch(/^\s*signal:\s*\{/m);
      expect(extractImages(source).vault, id).toBeUndefined();
    }
  });

  test("both templates document the master key in .env.example", () => {
    for (const id of ["standard", "advanced"] as const) {
      const env = readFileSync(join(resolveTemplateDir(id), ".env.example"), "utf8");
      expect(env, id).toContain("OKE_VAULT_MASTER_KEY");
      expect(env, id).toContain("oke vault init");
    }
  });

  test("managed vault does not pin a compose image", () => {
    const next = applyCreateAnswers(
      templateConfig("standard"),
      toCreateDefaults({
        template: "standard",
        profile: "docker-ready",
        drivers: {
          store: {
            sql: pinsDockerReady("postgres", "pglite"),
            kv: pinsDockerReady("redis", "memory"),
            files: pinsDockerReady("s3", "memory"),
            index: null,
          },
          signal: pinsDockerReady("redis", "memory"),
          clock: pinsDockerReady("postgres", "frozen"),
          vault: pinsDockerReady("managed", "memory"),
          channel: { email: pinsDockerReady("smtp", "console") },
          ai: null,
        },
        ai: { enabled: false, provider: null, driver: null },
        locales: [],
        pgdog: false,
        proxy: "none",
      }),
    );
    expect(next).toMatch(/vault:\s*\{\s*dev: "managed"/);
    expect(extractImages(next).vault).toBeUndefined();
  });
});

describe("upsertAiDrivers", () => {
  const ollamaPins: EnvDriverPins = {
    dev: "ollama",
    test: "mock",
    prod: "ollama",
  };

  test("inserts drivers.ai inside drivers (not images / channel)", () => {
    const next = upsertAiDrivers(templateConfig("advanced"), ollamaPins);
    const config = evalConfig(next);
    expect(config.drivers?.ai).toEqual(ollamaPins);
    expect(config.drivers?.channel?.ai).toBeUndefined();
    // Sparse templates omit drivers.channel — images.channel stays a string pin.
    expect(config.images?.channel?.email).toBe("axllent/mailpit:v1.30.7");
    expect(config.images?.ai).toBeUndefined();
  });

  test("applyCreateAnswers with ai pins keeps top-level drivers.ai", () => {
    const llamaPins = pinsDockerReady("openai-compatible", "mock");
    for (const id of ["standard", "advanced"] as const) {
      const next = applyCreateAnswers(
        templateConfig(id),
        toCreateDefaults({
          template: "advanced",
          profile: "docker-ready",
          drivers: {
            store: {
              sql: pinsDockerReady("postgres", "pglite"),
              kv: pinsDockerReady("redis", "memory"),
              files: pinsDockerReady("s3", "memory"),
              index: null,
            },
            signal: pinsDockerReady("redis", "memory"),
            clock: pinsDockerReady("postgres", "frozen"),
            vault: pinsDockerReady("vault", "memory"),
            channel: { email: pinsDockerReady("smtp", "console") },
            ai: llamaPins,
          },
          ai: { enabled: true, provider: "llama-cpp", driver: "openai-compatible" },
          locales: [],
          pgdog: false,
          proxy: "none",
        }),
      );
      const config = evalConfig(next);
      expect(config.drivers?.ai, id).toEqual({
        dev: "openai-compatible",
        test: "mock",
        prod: "openai-compatible",
      });
      expect(config.drivers?.channel?.ai, id).toBeUndefined();
      expect(config.images?.ai, id).toBe("ghcr.io/ggml-org/llama.cpp:server-b10450");
    }
  });
});
