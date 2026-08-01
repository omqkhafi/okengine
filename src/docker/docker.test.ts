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

  test("meilisearch matches the official image and emits a http URL", () => {
    expect(recipeFor("getmeili/meilisearch:v1.37").id).toBe("meilisearch");
    const spec: ServiceSpec = {
      role: "store.index",
      serviceName: "store-index",
      image: "getmeili/meilisearch:v1.37",
      port: 7700,
      hostPort: 7700,
      credentials: { user: "oke", password: "meili-master-key", database: "oke" },
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(applied.environment?.MEILI_MASTER_KEY).toBe("${OKE_STORE_INDEX_KEY}");
    expect(applied.volumes).toContain("store-index-data:/meili_data");
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 7700,
      user: "oke",
      password: "meili-master-key",
      database: "oke",
    });
    expect(url).toBe("http://127.0.0.1:7700");
  });

  test("ollama matches the official image, pulls configured model, emits http URL", () => {
    expect(recipeFor("ollama/ollama:latest").id).toBe("ollama");
    const spec: ServiceSpec = {
      role: "ai",
      serviceName: "ai",
      image: "ollama/ollama:latest",
      port: 11434,
      hostPort: 11434,
      credentials: { user: "oke", password: "unused", database: "oke" },
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(applied.environment?.OKE_AI_MODEL).toBe("${OKE_AI_MODEL:-qwen3:8b}");
    expect(applied.volumes).toContain("ai-data:/root/.ollama");
    expect(applied.healthcheck?.test.join(" ")).toContain("ollama list");
    expect(String(applied.command)).toContain("ollama pull");
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 11434,
      user: "oke",
      password: "unused",
      database: "oke",
    });
    expect(url).toBe("http://127.0.0.1:11434");
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
        healthcheck: {
          test: ["CMD", "nats-server", "--signal", "ldm"],
          interval: "5s",
          timeout: "3s",
          retries: 5,
        },
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

    const sqlYml = result.files.find((f) => f.path === "compose.store.sql.yml")!.content;
    expect(sqlYml).toContain("pgvector/pgvector:pg17");
    expect(sqlYml).toContain("POSTGRES_PASSWORD");
    expect(sqlYml).toContain("${OKE_STORE_SQL_PASSWORD}");
    expect(sqlYml).toContain(".env.docker");
    expect(sqlYml).not.toContain(fixedCreds["store.sql"].password);

    const baseYml = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(baseYml).toContain('context: ".."');
    expect(baseYml).toContain("app:");

    for (const f of result.files) {
      assertNoCredentialsInYaml(f.content, Object.values(fixedCreds));
    }

    expect(result.stackEnv.DATABASE_URL).toContain("postgres://");
    expect(result.stackEnv.OKE_STORE_SQL_PASSWORD).toBe(fixedCreds["store.sql"].password);
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

  test("store.index meilisearch emits its own URL + master key env", () => {
    const result = deriveInfrastructure({
      images: { "store.index": "getmeili/meilisearch:v1.37" },
      credentials: {
        "store.index": { user: "oke", password: "meili-master-key", database: "oke" },
      },
      app: "skyport",
    });
    const yml = result.files.find((f) => f.path === "compose.store.index.yml")!.content;
    expect(yml).toContain("getmeili/meilisearch:v1.37");
    expect(yml).toContain("${OKE_STORE_INDEX_KEY}");
    expect(yml).toContain("meili_data");
    expect(yml).not.toContain("meili-master-key");
    expect(result.stackEnv.OKE_STORE_INDEX_URL).toBe("http://127.0.0.1:7700");
    expect(result.stackEnv.OKE_STORE_INDEX_KEY).toBe("meili-master-key");
    expect(result.stackEnv.DATABASE_URL).toBeUndefined();
  });

  test("ai ollama emits OKE_AI_URL and documents the default model control", () => {
    const result = deriveInfrastructure({
      images: { ai: "ollama/ollama:latest" },
      app: "skyport",
    });
    const yml = result.files.find((f) => f.path === "compose.ai.yml")!.content;
    expect(yml).toContain("ollama/ollama:latest");
    expect(yml).toContain("OKE_AI_MODEL");
    expect(yml).toContain("qwen3:8b");
    expect(result.stackEnv.OKE_AI_URL).toBe("http://127.0.0.1:11434");
    const envText = formatStackEnv(result.stackEnv);
    expect(envText).toContain("# ── ai — Ollama");
  });

  test("emits protocol-specific env keys plus optional control notes", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:18-alpine",
        "store.kv": "redis:8-alpine",
        "store.files": "rustfs/rustfs:1.0.0-beta.11",
        "channel.email": "axllent/mailpit:v1.22.3",
      },
      credentials: {
        ...fixedCreds,
        "store.files": {
          user: "files-key",
          password: "files-secret",
          database: "oke",
        },
        "channel.email": {
          user: "unused",
          password: "unused-secret",
          database: "oke",
        },
      },
    });
    expect(result.stackEnv.S3_ACCESS_KEY_ID).toBe("files-key");
    expect(result.stackEnv.S3_SECRET_ACCESS_KEY).toBe("files-secret");
    expect(result.stackEnv.S3_BUCKET).toBe("oke");
    expect(result.stackEnv.S3_URL).toContain("http://files-key:");
    expect(result.stackEnv.S3_ENDPOINT).toBe("http://127.0.0.1:9000");
    expect(result.stackEnv.S3_CONSOLE_URL).toBe("http://127.0.0.1:9001");
    expect(result.stackEnv.SMTP_URL).toBe("smtp://127.0.0.1:1025");
    expect(result.stackEnv.SMTP_HOST).toBe("127.0.0.1");
    expect(result.stackEnv.SMTP_PORT).toBe("1025");
    expect(result.stackEnv.MAILPIT_UI_URL).toBe("http://127.0.0.1:8025");
    expect(result.stackEnv.OKE_STORE_KV_PASSWORD).toBe(fixedCreds["store.kv"].password);
    expect(result.stackEnv.OKE_STORE_KV_USER).toBeUndefined();
    expect(result.stackEnv.OKE_STORE_KV_DB).toBeUndefined();
    expect(result.stackEnv.OKE_CHANNEL_EMAIL_PASSWORD).toBeUndefined();

    const text = formatStackEnv(result.stackEnv);
    expect(text).toContain("# OKE_STORE_KV_MAXMEMORY=256mb");
    expect(text).toContain("# S3_SESSION_TOKEN=");
    expect(text).toContain("# SMTP_USER=");
    expect(text).toContain("# POSTGRES_INITDB_ARGS=--data-checksums");
  });

  test("instance-offset UI aliases land in stack env", () => {
    const id = "a3f791";
    const n = Number.parseInt(id.slice(0, 4), 16) % 1000;
    const result = deriveInfrastructure({
      images: {
        "channel.email": "axllent/mailpit:v1.22.3",
        "store.files": "rustfs/rustfs:1.0.0-beta.11",
      },
      instanceId: id,
      credentials: {
        "channel.email": {
          user: "oke",
          password: "unused-mail-password",
          database: "oke",
        },
        "store.files": {
          user: "files-key",
          password: "files-secret",
          database: "oke",
        },
      },
    });
    expect(result.stackEnv.SMTP_PORT).toBe(String(20_000 + n));
    expect(result.stackEnv.MAILPIT_UI_URL).toBe(`http://127.0.0.1:${21_000 + n}`);
    expect(result.stackEnv.S3_ENDPOINT).toBe(`http://127.0.0.1:${18_000 + n}`);
    expect(result.stackEnv.S3_CONSOLE_URL).toBe(`http://127.0.0.1:${19_000 + n}`);
  });

  test("resolveStack previews without writing", () => {
    const rows = resolveStack({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recipe).toBe("postgres");
    expect(rows[0]!.hostPort).toBe(5432);
    expect(rows[0]!.extraPorts).toEqual([]);
  });

  test("resolveStack includes instance-offset Mailpit UI / RustFS console", () => {
    const id = "a3f791";
    const n = Number.parseInt(id.slice(0, 4), 16) % 1000;
    const rows = resolveStack({
      images: {
        "channel.email": "axllent/mailpit:v1.22.3",
        "store.files": "rustfs/rustfs:1.0.0-beta.11",
      },
      instanceId: id,
      credentials: {
        "channel.email": {
          user: "oke",
          password: "stack-preview-mail-password",
          database: "oke",
        },
        "store.files": {
          user: "oke",
          password: "stack-preview-files-password",
          database: "oke",
        },
      },
    });
    const mail = rows.find((r) => r.role === "channel.email")!;
    const files = rows.find((r) => r.role === "store.files")!;
    expect(mail.hostPort).toBe(20_000 + n);
    expect(mail.extraPorts).toEqual([{ hostPort: 21_000 + n, containerPort: 8025 }]);
    expect(files.hostPort).toBe(18_000 + n);
    expect(files.extraPorts).toEqual([{ hostPort: 19_000 + n, containerPort: 9001 }]);
  });
});
