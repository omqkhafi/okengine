/**
 * `ImagesConfig` (config surface, nested) → internal flat role map.
 *
 * Two guarantees:
 * 1. Every built-in image recipe is reachable through the nested shape,
 *    correctly placed under its owning element (or flat, for roles with no
 *    driver counterpart) — the type-safety gap this closes.
 * 2. A nested config produces byte-identical `deriveInfrastructure()` output
 *    (Dockerfile / compose / stack env) to the flat-shape equivalent it
 *    replaces — nesting is a config-surface change only, never an internal
 *    representation change.
 */

import { describe, expect, test } from "bun:test";
import { flattenImagesConfig, type ImagesConfig } from "../config/index.ts";
import { deriveInfrastructure } from "./derive.ts";
import { builtinRecipes, recipeFor } from "./recipes/index.ts";
import type { ServiceCredentials } from "./types.ts";

describe("ImagesConfig nesting — recipe coverage", () => {
  test("every built-in recipe id is reachable, correctly nested/flat by role", () => {
    const cases: ReadonlyArray<{ images: ImagesConfig; role: string; image: string }> = [
      // store.sql — postgres-family
      {
        images: { store: { sql: "postgres:18-alpine" } },
        role: "store.sql",
        image: "postgres:18-alpine",
      },
      {
        images: { store: { sql: "cockroachdb/cockroach:v24.1.0" } },
        role: "store.sql",
        image: "cockroachdb/cockroach:v24.1.0",
      },
      {
        images: { store: { sql: "yugabytedb/yugabyte:2024.1.0.0-b1" } },
        role: "store.sql",
        image: "yugabytedb/yugabyte:2024.1.0.0-b1",
      },
      {
        images: { store: { sql: "timescale/timescaledb:2.15.0-pg16" } },
        role: "store.sql",
        image: "timescale/timescaledb:2.15.0-pg16",
      },
      {
        images: { store: { sql: "supabase/postgres:15.1.0.117" } },
        role: "store.sql",
        image: "supabase/postgres:15.1.0.117",
      },
      // store.kv — redis-family
      { images: { store: { kv: "redis:8-alpine" } }, role: "store.kv", image: "redis:8-alpine" },
      {
        images: { store: { kv: "valkey/valkey:8-alpine" } },
        role: "store.kv",
        image: "valkey/valkey:8-alpine",
      },
      {
        images: { store: { kv: "docker.dragonflydb.io/dragonflydb/dragonfly:v1.24.0" } },
        role: "store.kv",
        image: "docker.dragonflydb.io/dragonflydb/dragonfly:v1.24.0",
      },
      // store.files / store.index
      {
        images: { store: { files: "rustfs/rustfs:1.0.0-beta.11" } },
        role: "store.files",
        image: "rustfs/rustfs:1.0.0-beta.11",
      },
      {
        images: { store: { index: "getmeili/meilisearch:v1.37" } },
        role: "store.index",
        image: "getmeili/meilisearch:v1.37",
      },
      // channel.email
      {
        images: { channel: { email: "axllent/mailpit:v1.22.3" } },
        role: "channel.email",
        image: "axllent/mailpit:v1.22.3",
      },
      // flat roles — no driver counterpart in DriversConfig
      {
        images: { ai: "ghcr.io/ggml-org/llama.cpp:server-b10290" },
        role: "ai",
        image: "ghcr.io/ggml-org/llama.cpp:server-b10290",
      },
      { images: { ai: "vllm/vllm-openai:v0.26.0" }, role: "ai", image: "vllm/vllm-openai:v0.26.0" },
      {
        images: { ai: "lmsysorg/sglang:v0.5.16-runtime" },
        role: "ai",
        image: "lmsysorg/sglang:v0.5.16-runtime",
      },
      { images: { ai: "ollama/ollama:0.32.6" }, role: "ai", image: "ollama/ollama:0.32.6" },
      {
        images: { pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51" },
        role: "pgdog",
        image: "ghcr.io/pgdogdev/pgdog:v0.1.51",
      },
      { images: { proxy: "caddy:2-alpine" }, role: "proxy", image: "caddy:2-alpine" },
      { images: { proxy: "traefik:v3.1" }, role: "proxy", image: "traefik:v3.1" },
    ];

    const matchedIds = new Set<string>();
    for (const { images, role, image } of cases) {
      // The nested literal flattens to exactly the dotted/flat role key the
      // rest of the pipeline (buildSpecs, credentials, env prefixes) expects.
      expect(flattenImagesConfig(images)).toEqual({ [role]: image });
      matchedIds.add(recipeFor(image).id);
    }

    expect(matchedIds).toEqual(new Set(builtinRecipes.map((r) => r.id)));
  });
});

describe("ImagesConfig nesting — compose output parity", () => {
  test("nested config derives byte-identical output to its flat-shape equivalent", () => {
    const flatImages: Readonly<Record<string, string>> = {
      "store.sql": "postgres:18-alpine",
      pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
      "store.kv": "redis:8-alpine",
      "store.files": "rustfs/rustfs:1.0.0-beta.11",
      "store.index": "getmeili/meilisearch:v1.37",
      "channel.email": "axllent/mailpit:v1.22.3",
    };

    const nestedImages: ImagesConfig = {
      store: {
        sql: "postgres:18-alpine",
        kv: "redis:8-alpine",
        files: "rustfs/rustfs:1.0.0-beta.11",
        index: "getmeili/meilisearch:v1.37",
      },
      channel: { email: "axllent/mailpit:v1.22.3" },
      pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
    };

    // Same nested→flat set, written in a different field order — proves the
    // parity holds independent of source object key order.
    expect(flattenImagesConfig(nestedImages)).toEqual(flatImages);

    const credentials: Readonly<Record<string, ServiceCredentials>> = {
      "store.sql": { user: "oke", password: "fixed-pw-sql", database: "oke" },
      "store.kv": { user: "oke", password: "fixed-pw-kv", database: "oke" },
      "store.files": { user: "oke", password: "fixed-pw-files", database: "oke" },
      "store.index": { user: "oke", password: "fixed-pw-index", database: "oke" },
      "channel.email": { user: "oke", password: "fixed-pw-email", database: "oke" },
      pgdog: { user: "oke", password: "fixed-pw-pgdog", database: "oke" },
    };

    const fromFlat = deriveInfrastructure({
      images: flatImages,
      app: "images-nesting-parity",
      credentials,
    });
    const fromNested = deriveInfrastructure({
      images: flattenImagesConfig(nestedImages),
      app: "images-nesting-parity",
      credentials,
    });

    expect(fromNested.specs).toEqual(fromFlat.specs);
    expect(fromNested.files).toEqual(fromFlat.files);
    expect(fromNested.stackEnv).toEqual(fromFlat.stackEnv);
    expect(fromNested.composeFiles).toEqual(fromFlat.composeFiles);
  });
});
