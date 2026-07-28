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
    expect(recipeFor("axllent/mailpit:v1.22.3").id).toBe("mailpit");
    expect(recipeFor("rustfs/rustfs:1.0.0-beta.11").id).toBe("rustfs");
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

  test("mailpit and rustfs publish extra UI ports", () => {
    const result = deriveInfrastructure({
      images: {
        "channel.email": "axllent/mailpit:v1.22.3",
        "store.files": "rustfs/rustfs:1.0.0-beta.11",
      },
      includeApp: false,
      credentials: {
        "channel.email": {
          user: "mail",
          password: "unused-mail-password-xyz",
          database: "mail",
        },
        "store.files": {
          user: "oke",
          password: "s3cret-files-password-xyz",
          database: "oke",
        },
      },
    });
    const mailYml = result.files.find(
      (f) => f.path === "compose.channel.email.yml",
    )!.content;
    const filesYml = result.files.find(
      (f) => f.path === "compose.store.files.yml",
    )!.content;
    expect(mailYml).toContain("8025:8025");
    expect(filesYml).toContain("9001:9001");
    expect(filesYml).toContain("${OKE_STORE_FILES_ACCESS_KEY}");
    expect(filesYml).toContain("${OKE_STORE_FILES_SECRET_KEY}");
    expect(result.stackEnv.OKE_CHANNEL_EMAIL_URL).toContain("smtp://");
    expect(result.stackEnv.SMTP_URL).toBe(result.stackEnv.OKE_CHANNEL_EMAIL_URL);
    expect(result.stackEnv.OKE_CHANNEL_EMAIL_UI_URL).toContain("http://127.0.0.1:8025");
    expect(result.stackEnv.OKE_CHANNEL_EMAIL_USER).toBeUndefined();
    expect(result.stackEnv.OKE_CHANNEL_EMAIL_PASSWORD).toBeUndefined();
    expect(result.stackEnv.OKE_CHANNEL_EMAIL_DB).toBeUndefined();
    expect(result.stackEnv.OKE_STORE_FILES_ACCESS_KEY).toBe("oke");
    expect(result.stackEnv.OKE_STORE_FILES_SECRET_KEY).toBe(
      "s3cret-files-password-xyz",
    );
    expect(result.stackEnv.OKE_STORE_FILES_BUCKET).toBe("oke");
    expect(result.stackEnv.OKE_STORE_FILES_USER).toBeUndefined();
    expect(result.stackEnv.S3_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(result.stackEnv.OKE_STORE_FILES_UI_URL).toContain(":9001");
    expect(result.stackEnv.OKE_STORE_FILES_URL).toContain("127.0.0.1:9000");
  });

  test("stack env is recipe-accurate (no fake USER/DB on redis/mail)", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:16",
        "store.kv": "redis:8-alpine",
        "channel.email": "axllent/mailpit:v1.22.3",
      },
      includeApp: false,
      credentials: {
        "store.sql": fixedCreds["store.sql"],
        "store.kv": fixedCreds["store.kv"],
        "channel.email": {
          user: "unused",
          password: "unused-mail",
          database: "unused",
        },
      },
    });
    expect(result.stackEnv.OKE_STORE_SQL_USER).toBe("oke");
    expect(result.stackEnv.DATABASE_URL).toContain("postgres://");
    expect(result.stackEnv.OKE_STORE_KV_PASSWORD).toBe(
      fixedCreds["store.kv"].password,
    );
    expect(result.stackEnv.OKE_STORE_KV_USER).toBeUndefined();
    expect(result.stackEnv.OKE_STORE_KV_DB).toBeUndefined();
    expect(result.stackEnv.REDIS_URL).toContain("redis://");
    const text = formatStackEnv(result.stackEnv);
    expect(text).toContain("# ── channel.email — SMTP (Mailpit)");
    expect(text).not.toContain("OKE_CHANNEL_EMAIL_USER=");
    expect(text).not.toContain("OKE_STORE_KV_USER=");
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
    expect(sqlYml).toContain(".env.docker");
    expect(sqlYml).not.toContain("../.env.docker");
    expect(sqlYml).not.toContain(fixedCreds["store.sql"].password);

    const baseYml = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(baseYml).toContain("context: \"..\"");
    expect(baseYml).toContain("app:");

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

  test("includeApp false omits app service (infra-only stack)", () => {
    const result = deriveInfrastructure({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
      includeApp: false,
      app: "dev",
    });
    const base = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(base).toContain("oke-dev");
    expect(base).toContain("networks:");
    expect(base).not.toContain("app:");
    expect(base).not.toContain("build:");
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
    const root = await mkdtemp(join(tmpdir(), "oke-docker-"));
    const dockerDir = join(root, "docker");
    const result = deriveInfrastructure({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    const written = await writeDerivedFiles(result, dockerDir, {
      writeStackEnv: true,
    });
    expect(written.some((p) => p.endsWith(COMPOSE_OVERRIDE))).toBe(false);
    expect(await Bun.file(join(dockerDir, ".env.docker")).exists()).toBe(true);
    expect(await Bun.file(join(dockerDir, "compose.yml")).exists()).toBe(true);
    const envText = await Bun.file(join(dockerDir, ".env.docker")).text();
    expect(envText).toContain("DATABASE_URL=");
    expect(envText).toContain("# docker/.env.docker — generated by");
    expect(envText).toContain("# ── store.sql — Postgres");
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
