/**
 * Image recipes + compose derivation.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPOSE_OVERRIDE,
  assertNoCredentialsInYaml,
  builtinRecipes,
  deriveInfrastructure,
  emitDockerfile,
  formatStackEnv,
  postgres,
  recipeFor,
  redis,
  resolveStack,
  writeDerivedFiles,
  type ImageRecipe,
  type ServiceSpec,
} from "./index.ts";

const fixedCreds = {
  "store.sql": {
    user: "oke",
    password: "s3cret-sql-password-xyz",
    database: "oke",
  },
  "store.kv": {
    user: "oke",
    password: "s3cret-kv-password-xyz",
    database: "oke",
  },
} as const;

describe("image recipes", () => {
  test("postgres and redis match vendor images by protocol", () => {
    expect(recipeFor("pgvector/pgvector:pg17").id).toBe("postgres");
    expect(recipeFor("valkey/valkey:8-alpine").id).toBe("redis");
    expect(postgres.match("postgres:16")).toBe(true);
    expect(redis.match("redis:7")).toBe(true);
  });

  test("a new image recipe is ≤15 lines", async () => {
    const src = await Bun.file(`${import.meta.dir}/recipes/postgres.ts`).text();
    const exportLines = src
      .slice(src.indexOf("export const"))
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(exportLines.length).toBeLessThanOrEqual(15);
  });

  test("recipe.url builds a connection string without env-var names in the kernel", () => {
    const spec: ServiceSpec = {
      role: "store.sql",
      serviceName: "store-sql",
      image: "postgres:16",
      port: 5432,
      hostPort: 5432,
      credentials: fixedCreds["store.sql"],
    };
    const url = postgres.url(spec, {
      host: "127.0.0.1",
      port: 5432,
      ...fixedCreds["store.sql"],
    });
    expect(url).toStartWith("postgres://oke:");
    expect(url).toContain("@127.0.0.1:5432/oke");
    expect(url).not.toContain("POSTGRES_");
  });

  test("plugin recipe can be registered in ≤15 lines", () => {
    const nats: ImageRecipe = {
      id: "nats",
      port: 4222,
      match: (i) => /nats/i.test(i),
      apply: () => ({
        command: ["--js"],
        healthcheck: { test: ["CMD", "nats-server", "--signal", "ldm"], interval: "5s", timeout: "3s", retries: 5 },
      }),
      url: (_s, c) => `nats://${c.host}:${c.port}`,
    };
    const src = `export const nats: ImageRecipe = {
  id: "nats",
  port: 4222,
  match: (i) => /nats/i.test(i),
  apply: () => ({ command: ["--js"], healthcheck: { test: ["CMD", "nats-server", "--signal", "ldm"], interval: "5s", timeout: "3s", retries: 5 } }),
  url: (_s, c) => \`nats://\${c.host}:\${c.port}\`,
};`;
    expect(src.trim().split("\n").length).toBeLessThanOrEqual(15);
    expect(recipeFor("nats:2.10", [nats]).id).toBe("nats");
    expect(builtinRecipes.length).toBeGreaterThanOrEqual(2);
  });
});

describe("deriveInfrastructure", () => {
  test("emits Dockerfile + per-role compose + four-layer merge order", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "pgvector/pgvector:pg17",
        "store.kv": "valkey/valkey:8-alpine",
      },
      credentials: fixedCreds,
      app: "skyport",
    });

    const paths = result.files.map((f) => f.path);
    expect(paths).toContain("Dockerfile");
    expect(paths).toContain("compose.yml");
    expect(paths).toContain("compose.store.sql.yml");
    expect(paths).toContain("compose.store.kv.yml");
    expect(paths).not.toContain(COMPOSE_OVERRIDE);

    expect(result.composeFiles).toEqual([
      "compose.yml",
      "compose.store.kv.yml",
      "compose.store.sql.yml",
      COMPOSE_OVERRIDE,
    ]);

    const sqlYml = result.files.find((f) => f.path === "compose.store.sql.yml")!
      .content;
    expect(sqlYml).toContain("pgvector/pgvector:pg17");
    expect(sqlYml).toContain("POSTGRES_PASSWORD");
    expect(sqlYml).toContain("${OKE_STORE_SQL_PASSWORD}");
    expect(sqlYml).not.toContain(fixedCreds["store.sql"].password);

    for (const f of result.files) {
      assertNoCredentialsInYaml(
        f.content,
        Object.values(fixedCreds),
      );
    }

    expect(result.stackEnv.DATABASE_URL).toContain("postgres://");
    expect(result.stackEnv.OKE_STORE_SQL_PASSWORD).toBe(
      fixedCreds["store.sql"].password,
    );
  });

  test("prod overlay adds deploy.replicas and is layer 3", () => {
    const result = deriveInfrastructure({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
      prod: true,
    });
    expect(result.files.some((f) => f.path === "compose.prod.yml")).toBe(true);
    expect(result.composeFiles).toContain("compose.prod.yml");
    expect(result.composeFiles.at(-1)).toBe(COMPOSE_OVERRIDE);
    const prod = result.files.find((f) => f.path === "compose.prod.yml")!.content;
    expect(prod).toContain("replicas");
  });

  test("Dockerfile CMD is oke start", () => {
    const df = emitDockerfile();
    expect(df).toContain('CMD ["oke", "start"]');
    expect(df).toContain("oven/bun:1.3");
  });

  test("writeDerivedFiles never writes compose.override.yml", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-docker-"));
    const result = deriveInfrastructure({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    const written = await writeDerivedFiles(result, dir, { writeStackEnv: true });
    expect(written.some((p) => p.endsWith(COMPOSE_OVERRIDE))).toBe(false);
    expect(await Bun.file(join(dir, ".env.stack")).exists()).toBe(true);
    const envText = await Bun.file(join(dir, ".env.stack")).text();
    expect(envText).toContain("DATABASE_URL=");
    expect(formatStackEnv(result.stackEnv)).toContain("OKE_STORE_SQL_PASSWORD=");
  });

  test("resolveStack previews without writing", () => {
    const rows = resolveStack({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipe).toBe("postgres");
    expect(rows[0]!.hostPort).toBe(5432);
  });
});
