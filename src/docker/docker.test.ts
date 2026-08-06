/**
 * Image recipes + compose derivation.
 */

import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  COMPOSE_ALL,
  COMPOSE_OVERRIDE,
  assertNoCredentialsInYaml,
  buildCaddyfile,
  buildPgDogToml,
  buildPgDogUsersToml,
  builtinRecipes,
  caddy,
  cockroach,
  deriveInfrastructure,
  dragonfly,
  emitDockerfile,
  formatStackEnv,
  pgdog,
  postgres,
  recipeFor,
  redis,
  resolveStack,
  SOCKET_PROXY_IMAGE,
  SOCKET_PROXY_SERVICE,
  timescale,
  traefik,
  traefikAppLabels,
  valkey,
  writeDerivedFiles,
  yugabyte,
  ensureOllamaModel,
  llamaCpp,
  LLAMA_CPP_IMAGE,
  LLAMA_CPP_MIN_SAFE_BUILD,
  OllamaPullError,
  OLLAMA_IMAGE,
  OLLAMA_MIN_SAFE_VERSION,
  sglang,
  SGLANG_IMAGE,
  vllm,
  VLLM_IMAGE,
  type ImageRecipe,
  type OllamaFetch,
  type ServiceSpec,
} from "./index.ts";

/** Service keys under a top-level `services:` mapping (2-space indent). */
function serviceNamesFromComposeYaml(yml: string): Set<string> {
  const names = new Set<string>();
  let inServices = false;
  for (const line of yml.split("\n")) {
    if (line === "services:") {
      inServices = true;
      continue;
    }
    if (!inServices) continue;
    if (/^[A-Za-z]/.test(line)) break;
    const m = /^  ([A-Za-z0-9_-]+):\s*$/.exec(line);
    if (m?.[1]) names.add(m[1]);
  }
  return names;
}

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
    expect(postgres.match("postgres:16")).toBe(true);
    expect(redis.match("redis:7")).toBe(true);
    expect(redis.match("redis:8-alpine")).toBe(true);
    expect(redis.match("valkey/valkey:8-alpine")).toBe(false);
  });

  test("valkey matches the official image, keeps redis:// URL, uses valkey-server", () => {
    const image = "valkey/valkey:8-alpine";
    expect(recipeFor(image).id).toBe("valkey");
    expect(valkey.match(image)).toBe(true);
    expect(redis.match(image)).toBe(false);
    const spec: ServiceSpec = {
      role: "store.kv",
      serviceName: "store-kv",
      image,
      port: 6379,
      hostPort: 6379,
      credentials: fixedCreds["store.kv"],
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(String(applied.command)).toContain("exec valkey-server");
    expect(String(applied.command)).toContain("$$OKE_STORE_KV_PASSWORD");
    expect(applied.healthcheck?.test[1]).toBe("valkey-cli");
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 6379,
      user: "oke",
      password: fixedCreds["store.kv"].password,
      database: "oke",
    });
    expect(url).toBe(
      `redis://:${encodeURIComponent(fixedCreds["store.kv"].password)}@127.0.0.1:6379`,
    );

    const derived = deriveInfrastructure({
      images: { "store.kv": image },
      credentials: { "store.kv": fixedCreds["store.kv"] },
    });
    const kvYml = derived.files.find((f) => f.path === "compose.store.kv.yml")?.content ?? "";
    expect(kvYml).toContain(image);
    expect(kvYml).toContain("valkey-server");
    expect(derived.stackEnv.REDIS_URL).toContain("redis://");
  });

  test("dragonfly matches the official image, keeps redis:// URL, distinct from redis recipe", () => {
    const image = "docker.dragonflydb.io/dragonflydb/dragonfly";
    expect(recipeFor(image).id).toBe("dragonfly");
    expect(dragonfly.match(image)).toBe(true);
    expect(redis.match(image)).toBe(false);
    const spec: ServiceSpec = {
      role: "store.kv",
      serviceName: "store-kv",
      image,
      port: 6379,
      hostPort: 6379,
      credentials: fixedCreds["store.kv"],
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(String(applied.command)).toContain("exec dragonfly");
    expect(String(applied.command)).toContain("$$OKE_STORE_KV_PASSWORD");
    expect(applied.ulimits?.memlock).toBe(-1);
    expect(applied.environment?.HEALTHCHECK_PORT).toBe("6379");
    expect(applied.healthcheck?.test).toEqual(["CMD", "/usr/local/bin/healthcheck.sh"]);
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 6379,
      user: "oke",
      password: fixedCreds["store.kv"].password,
      database: "oke",
    });
    expect(url).toBe(
      `redis://:${encodeURIComponent(fixedCreds["store.kv"].password)}@127.0.0.1:6379`,
    );

    const derived = deriveInfrastructure({
      images: { "store.kv": image },
      credentials: { "store.kv": fixedCreds["store.kv"] },
    });
    const kvYml = derived.files.find((f) => f.path === "compose.store.kv.yml")?.content ?? "";
    expect(kvYml).toContain(image);
    expect(kvYml).toContain("memlock");
    expect(kvYml).toContain("HEALTHCHECK_PORT");
    expect(derived.stackEnv.REDIS_URL).toContain("redis://");
  });

  test("cockroach matches official image, port 26257, COCKROACH_* env, sslmode=require URL", () => {
    const image = "cockroachdb/cockroach:v25.2.0";
    expect(recipeFor(image).id).toBe("cockroach");
    expect(cockroach.match(image)).toBe(true);
    expect(postgres.match(image)).toBe(false);
    const spec: ServiceSpec = {
      role: "store.sql",
      serviceName: "store-sql",
      image,
      port: 26257,
      hostPort: 5432,
      credentials: fixedCreds["store.sql"],
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(applied.command).toEqual(["start-single-node", "--accept-sql-without-tls"]);
    expect(applied.environment?.COCKROACH_USER).toBe("${OKE_STORE_SQL_USER}");
    expect(applied.environment?.COCKROACH_PASSWORD).toBe("${OKE_STORE_SQL_PASSWORD}");
    expect(applied.environment?.COCKROACH_DATABASE).toBe("${OKE_STORE_SQL_DB}");
    expect(applied.extraPorts).toEqual([{ host: 8080, container: 8080 }]);
    expect(applied.volumes?.[0]).toContain("/cockroach/cockroach-data");
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 5432,
      ...fixedCreds["store.sql"],
    });
    expect(url).toContain("sslmode=require");
    expect(url).toContain(":5432/");

    const derived = deriveInfrastructure({
      images: { "store.sql": image },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    expect(derived.specs[0]!.port).toBe(26257);
    expect(derived.specs[0]!.hostPort).toBe(5432);
    const sqlYml = derived.files.find((f) => f.path === "compose.store.sql.yml")?.content ?? "";
    expect(sqlYml).toContain("26257");
    expect(sqlYml).toContain("COCKROACH_");
    expect(derived.stackEnv.DATABASE_URL).toContain("sslmode=require");
  });

  test("yugabyte matches official image, YSQL on 5433, YSQL_* env", () => {
    const image = "yugabytedb/yugabyte:2025.1.0.0-b100";
    expect(recipeFor(image).id).toBe("yugabyte");
    expect(yugabyte.match(image)).toBe(true);
    const spec: ServiceSpec = {
      role: "store.sql",
      serviceName: "store-sql",
      image,
      port: 5433,
      hostPort: 5432,
      credentials: fixedCreds["store.sql"],
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(String(applied.command)).toContain("yugabyted");
    expect(applied.environment?.YSQL_USER).toBe("${OKE_STORE_SQL_USER}");
    expect(applied.environment?.YSQL_PASSWORD).toBe("${OKE_STORE_SQL_PASSWORD}");
    expect(applied.environment?.YSQL_DB).toBe("${OKE_STORE_SQL_DB}");
    expect(applied.volumes?.[0]).toContain("/home/yugabyte/yb_data");
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 5432,
      ...fixedCreds["store.sql"],
    });
    expect(url).toStartWith("postgres://oke:");

    const derived = deriveInfrastructure({
      images: { "store.sql": image },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    expect(derived.specs[0]!.port).toBe(5433);
    const sqlYml = derived.files.find((f) => f.path === "compose.store.sql.yml")?.content ?? "";
    expect(sqlYml).toContain("5433");
    expect(sqlYml).toContain("YSQL_");
  });

  test("timescale matches ahead of generic postgres with the same POSTGRES_* contract", () => {
    const image = "timescale/timescaledb:latest-pg17";
    expect(recipeFor(image).id).toBe("timescale");
    expect(timescale.match(image)).toBe(true);
    expect(postgres.match(image)).toBe(false);
    const derived = deriveInfrastructure({
      images: { "store.sql": image },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    const sqlYml = derived.files.find((f) => f.path === "compose.store.sql.yml")?.content ?? "";
    expect(sqlYml).toContain("POSTGRES_USER");
    expect(derived.stackEnv.DATABASE_URL).toContain("postgres://");
  });

  test("pgdog matches the official image and waits on store-sql", () => {
    expect(recipeFor("ghcr.io/pgdogdev/pgdog:v0.1.51").id).toBe("pgdog");
    expect(pgdog.match("ghcr.io/pgdogdev/pgdog:main")).toBe(true);
    const applied = pgdog.apply({
      role: "pgdog",
      serviceName: "pgdog",
      image: "ghcr.io/pgdogdev/pgdog:v0.1.51",
      port: 6432,
      hostPort: 6432,
      credentials: fixedCreds["store.sql"],
    });
    expect(applied.dependsOn?.["store-sql"]?.condition).toBe("service_healthy");
    expect(applied.volumes).toContain("./pgdog.toml:/pgdog/pgdog.toml:ro");
    expect(applied.volumes).toContain("./users.toml:/pgdog/users.toml:ro");
    expect(applied.healthcheck?.test.join(" ")).toContain("pg_isready");
  });

  test("pgdog.toml + users.toml match upstream config shape", () => {
    const pgdogToml = buildPgDogToml({ database: "oke", postgresHost: "store-sql" });
    expect(pgdogToml).toContain("[general]");
    expect(pgdogToml).toContain('host = "0.0.0.0"');
    expect(pgdogToml).toContain("port = 6432");
    expect(pgdogToml).toContain('pooler_mode = "transaction"');
    expect(pgdogToml).toContain("[[databases]]");
    expect(pgdogToml).toContain('name = "oke"');
    expect(pgdogToml).toContain('host = "store-sql"');
    expect(pgdogToml).toContain("port = 5432");
    expect(pgdogToml).toContain('database_name = "oke"');

    const usersToml = buildPgDogUsersToml({
      user: "oke",
      password: "s3cret-sql-password-xyz",
      database: "oke",
    });
    expect(usersToml).toContain("[[users]]");
    expect(usersToml).toContain('name = "oke"');
    expect(usersToml).toContain('password = "s3cret-sql-password-xyz"');
    expect(usersToml).toContain('database = "oke"');
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

  test("ollama matches the official image, serves on 11434, emits http URL", () => {
    expect(recipeFor(OLLAMA_IMAGE).id).toBe("ollama");
    expect(OLLAMA_IMAGE).not.toContain("latest");
    expect(OLLAMA_MIN_SAFE_VERSION).toBe("0.17.1");
    const spec: ServiceSpec = {
      role: "ai",
      serviceName: "ai",
      image: OLLAMA_IMAGE,
      port: 11434,
      hostPort: 11434,
      credentials: { user: "oke", password: "unused", database: "oke" },
    };
    const applied = recipeFor(spec.image).apply(spec);
    expect(applied.environment?.OKE_AI_MODEL).toBe("${OKE_AI_MODEL:-qwen3.5:9b}");
    expect(applied.environment?.OLLAMA_HOST).toBe("0.0.0.0:11434");
    expect(applied.publishBind).toBe("127.0.0.1");
    expect(applied.volumes).toContain("ai-data:/root/.ollama");
    expect(applied.healthcheck?.test.join(" ")).toContain("ollama list");
    // Pull is host-side via ensureOllamaModel — never a boot `ollama pull` CLI.
    expect(applied.command).toBeUndefined();
    expect(applied.entrypoint).toBeUndefined();
    const url = recipeFor(spec.image).url(spec, {
      host: "127.0.0.1",
      port: 11434,
      user: "oke",
      password: "unused",
      database: "oke",
    });
    expect(url).toBe("http://127.0.0.1:11434");
  });

  test("llama-cpp is the default local AI recipe — OpenAI /v1, loopback publish, pinned ≥ b8146", () => {
    expect(recipeFor(LLAMA_CPP_IMAGE).id).toBe("llama-cpp");
    expect(LLAMA_CPP_IMAGE).not.toContain("latest");
    const build = Number(/server-b(\d+)/.exec(LLAMA_CPP_IMAGE)?.[1]);
    expect(build).toBeGreaterThanOrEqual(LLAMA_CPP_MIN_SAFE_BUILD);
    const spec: ServiceSpec = {
      role: "ai",
      serviceName: "ai",
      image: LLAMA_CPP_IMAGE,
      port: 8080,
      hostPort: 8080,
      credentials: { user: "oke", password: "unused", database: "oke" },
    };
    const applied = llamaCpp.apply(spec);
    expect(applied.publishBind).toBe("127.0.0.1");
    expect(applied.environment?.LLAMA_ARG_HOST).toBe("0.0.0.0");
    expect(applied.environment?.LLAMA_ARG_DOCKER_REPO).toContain("smollm2");
    expect(applied.extraPorts).toBeUndefined();
    expect(llamaCpp.url(spec, { host: "127.0.0.1", port: 8080, ...spec.credentials })).toBe(
      "http://127.0.0.1:8080/v1",
    );
  });

  test("vllm recipe is GPU-aware, OpenAI /v1, loopback publish, never latest", () => {
    expect(recipeFor(VLLM_IMAGE).id).toBe("vllm");
    expect(VLLM_IMAGE).not.toContain("latest");
    const spec: ServiceSpec = {
      role: "ai",
      serviceName: "ai",
      image: VLLM_IMAGE,
      port: 8000,
      hostPort: 8000,
      credentials: { user: "oke", password: "unused", database: "oke" },
    };
    const applied = vllm.apply(spec);
    expect(applied.publishBind).toBe("127.0.0.1");
    expect(applied.ipc).toBe("host");
    expect(JSON.stringify(applied.deploy)).toContain("nvidia");
    expect(vllm.url(spec, { host: "127.0.0.1", port: 8000, ...spec.credentials })).toBe(
      "http://127.0.0.1:8000/v1",
    );
  });

  test("sglang recipe is GPU-aware, OpenAI /v1, loopback publish, never latest", () => {
    expect(recipeFor(SGLANG_IMAGE).id).toBe("sglang");
    expect(SGLANG_IMAGE).not.toContain("latest");
    const spec: ServiceSpec = {
      role: "ai",
      serviceName: "ai",
      image: SGLANG_IMAGE,
      port: 30000,
      hostPort: 30000,
      credentials: { user: "oke", password: "unused", database: "oke" },
    };
    const applied = sglang.apply(spec);
    expect(applied.publishBind).toBe("127.0.0.1");
    expect(applied.ipc).toBe("host");
    expect(JSON.stringify(applied.deploy)).toContain("nvidia");
    expect(sglang.url(spec, { host: "127.0.0.1", port: 30000, ...spec.credentials })).toBe(
      "http://127.0.0.1:30000/v1",
    );
  });

  test("ensureOllamaModel POSTs /api/pull to the container base URL (not a host CLI)", async () => {
    const calls: { url: string; method: string; body?: string }[] = [];
    const fetchFn: OllamaFetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      const body = typeof init?.body === "string" ? init.body : undefined;
      calls.push({ url, method, ...(body !== undefined ? { body } : {}) });
      if (url.endsWith("/api/tags") && method === "GET") {
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      }
      if (url.endsWith("/api/pull") && method === "POST") {
        expect(body).toContain('"model":"qwen3.5:9b"');
        expect(body).toContain('"stream":true');
        return new Response(`${JSON.stringify({ status: "success" })}\n`, { status: 200 });
      }
      return new Response("unexpected", { status: 500 });
    };

    await ensureOllamaModel({
      url: "http://127.0.0.1:11434",
      model: "qwen3.5:9b",
      fetch: fetchFn,
      readyTimeoutMs: 2_000,
      pullTimeoutMs: 5_000,
    });

    expect(
      calls.some((c) => c.url === "http://127.0.0.1:11434/api/tags" && c.method === "GET"),
    ).toBe(true);
    const pull = calls.find((c) => c.url === "http://127.0.0.1:11434/api/pull");
    expect(pull?.method).toBe("POST");
    expect(pull?.body).toBe(JSON.stringify({ model: "qwen3.5:9b", stream: true }));
    // No host-side `ollama` binary assumption — only HTTP to the given URL.
    expect(calls.every((c) => c.url.startsWith("http://127.0.0.1:11434/"))).toBe(true);
  });

  test("ensureOllamaModel skips pull when /api/tags already lists the model", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const fetchFn: OllamaFetch = async (input, init) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();
      calls.push(`${method} ${url}`);
      if (url.endsWith("/api/tags")) {
        return new Response(JSON.stringify({ models: [{ name: "gemma4:e4b" }] }), {
          status: 200,
        });
      }
      return new Response("should not pull", { status: 500 });
    };

    await ensureOllamaModel({
      url: "http://127.0.0.1:23100",
      model: "gemma4:e4b",
      fetch: fetchFn,
      readyTimeoutMs: 2_000,
      onStatus: (line) => statuses.push(line),
    });

    expect(calls.some((c) => c.includes("/api/pull"))).toBe(false);
    expect(statuses.some((s) => /already has gemma4:e4b/.test(s))).toBe(true);
  });

  test("ensureOllamaModel fails loud when the container API never becomes ready", async () => {
    const fetchFn: OllamaFetch = async () => {
      throw new Error("connection refused");
    };
    await expect(
      ensureOllamaModel({
        url: "http://127.0.0.1:59999",
        model: "qwen3.5:9b",
        fetch: fetchFn,
        readyTimeoutMs: 800,
      }),
    ).rejects.toBeInstanceOf(OllamaPullError);
  });

  test("a new image recipe is ≤15 lines", async () => {
    const src = await Bun.file(`${import.meta.dir}/recipes/postgres.ts`).text();
    const exportLines = src
      .slice(src.indexOf("export const"))
      .split("\n")
      .filter((l) => l.trim().length > 0);
    expect(exportLines.length).toBeLessThanOrEqual(15);
  });

  test("caddy matches official images and emits a Caddyfile reverse_proxy", () => {
    expect(recipeFor("caddy:2-alpine").id).toBe("caddy");
    expect(caddy.match("library/caddy:2")).toBe(true);
    const spec: ServiceSpec = {
      role: "proxy",
      serviceName: "proxy",
      image: "caddy:2-alpine",
      port: 80,
      hostPort: 80,
      credentials: { user: "oke", password: "unused-proxy", database: "oke" },
    };
    const applied = caddy.apply(spec);
    expect(applied.extraPorts).toEqual([{ host: 443, container: 443 }]);
    expect(applied.volumes).toContain("./Caddyfile:/etc/caddy/Caddyfile:ro");
    expect(applied.volumes).toContain("proxy-data:/data");
    const file = buildCaddyfile();
    expect(file).toContain("{$OKE_PROXY_HOST:localhost}");
    expect(file).toContain("reverse_proxy app:6530");
    expect(caddy.url(spec, { host: "app.example.com", port: 443, ...spec.credentials })).toBe(
      "https://app.example.com",
    );
  });

  test("traefik matches official images, labels app, and uses socket-proxy", () => {
    expect(recipeFor("traefik:v3.3").id).toBe("traefik");
    expect(traefik.match("traefik:v3.1")).toBe(true);
    const applied = traefik.apply({
      role: "proxy",
      serviceName: "proxy",
      image: "traefik:v3.3",
      port: 80,
      hostPort: 80,
      credentials: { user: "oke", password: "unused-proxy", database: "oke" },
    });
    expect(applied.extraPorts).toEqual([{ host: 443, container: 443 }]);
    expect(String(applied.command)).toContain("--providers.docker=true");
    expect(String(applied.command)).toContain(`tcp://${SOCKET_PROXY_SERVICE}:2375`);
    expect(String(applied.command)).not.toContain("docker.sock");
    expect(applied.volumes?.some((v) => v.includes("docker.sock"))).toBeFalsy();
    expect(applied.dependsOn?.[SOCKET_PROXY_SERVICE]?.condition).toBe("service_started");
    const socket = applied.services?.[SOCKET_PROXY_SERVICE] as Record<string, unknown>;
    expect(socket.image).toBe(SOCKET_PROXY_IMAGE);
    expect(socket.volumes).toContain("/var/run/docker.sock:/var/run/docker.sock:ro");
    const labels = (applied.services?.app as { labels: Record<string, string> }).labels;
    expect(labels).toEqual(traefikAppLabels());
    expect(labels["traefik.enable"]).toBe("true");
    expect(labels["traefik.http.services.app.loadbalancer.server.port"]).toBe("6530");
    expect(labels["traefik.http.routers.app.rule"]).toContain("OKE_PROXY_HOST");
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
    expect(paths).toContain(COMPOSE_ALL);
    expect(paths).not.toContain(COMPOSE_OVERRIDE);

    expect(result.composeFiles).toEqual([
      "compose.yml",
      "compose.store.kv.yml",
      "compose.store.sql.yml",
      COMPOSE_OVERRIDE,
    ]);
    expect(result.composeFiles).not.toContain(COMPOSE_ALL);

    const sqlYml = result.files.find((f) => f.path === "compose.store.sql.yml")!.content;
    expect(sqlYml).toContain("pgvector/pgvector:pg17");
    expect(sqlYml).toContain("POSTGRES_PASSWORD");
    expect(sqlYml).toContain("${OKE_STORE_SQL_PASSWORD}");
    expect(sqlYml).toContain(".env.docker");
    expect(sqlYml).not.toContain(fixedCreds["store.sql"].password);

    const baseYml = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(baseYml).toContain('context: ".."');
    expect(baseYml).toContain("app:");
    expect(baseYml).toContain("oke-skyport:latest");

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
    expect(prod).toContain("/_/ready");
    expect(prod).toContain("update_config");
    expect(prod).toContain("restart_policy");
    expect(prod).toContain("stop_grace_period");
    expect(prod).toContain("start-first");
    expect(prod).toContain("on-failure");
  });

  test("when postgres + pgdog are both pinned, DATABASE_URL points at PgDog", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:18-alpine",
        pgdog: "ghcr.io/pgdogdev/pgdog:v0.1.51",
      },
      credentials: { "store.sql": fixedCreds["store.sql"] },
      prod: true,
      app: "skyport",
    });

    expect(result.stackEnv.DATABASE_URL).toContain(":6432/");
    expect(result.stackEnv.DATABASE_URL).toContain("postgres://oke:");
    expect(result.stackEnv.DATABASE_URL).toContain("/oke");
    expect(result.stackEnv.OKE_PGDOG_URL).toBe(result.stackEnv.DATABASE_URL);
    // Direct Postgres URL stays on the role key for ops / escape hatch.
    expect(result.stackEnv.OKE_STORE_SQL_URL).toContain(":5432/");

    const pgdogYml = result.files.find((f) => f.path === "compose.pgdog.yml")!.content;
    expect(pgdogYml).toContain("ghcr.io/pgdogdev/pgdog:v0.1.51");
    expect(pgdogYml).toContain("store-sql");
    expect(pgdogYml).toContain("service_healthy");
    expect(pgdogYml).not.toContain(fixedCreds["store.sql"].password);

    const pgdogToml = result.files.find((f) => f.path === "pgdog.toml")!.content;
    expect(pgdogToml).toContain('pooler_mode = "transaction"');
    expect(pgdogToml).toContain('host = "store-sql"');
    expect(pgdogToml).not.toContain(fixedCreds["store.sql"].password);

    const usersToml = result.files.find((f) => f.path === "users.toml")!.content;
    expect(usersToml).toContain('password = "s3cret-sql-password-xyz"');
    expect(usersToml).toContain('database = "oke"');
  });

  test("postgres alone keeps DATABASE_URL on 5432 (no pooler)", () => {
    const result = deriveInfrastructure({
      images: { "store.sql": "postgres:18-alpine" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
    });
    expect(result.stackEnv.DATABASE_URL).toContain(":5432/");
    expect(result.stackEnv.OKE_PGDOG_URL).toBeUndefined();
    expect(result.files.some((f) => f.path === "pgdog.toml")).toBe(false);
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

  test("ai ollama emits OKE_AI_URL, loopback publish, and never binds 0.0.0.0 on the host", () => {
    const result = deriveInfrastructure({
      images: { ai: OLLAMA_IMAGE },
      app: "skyport",
    });
    const yml = result.files.find((f) => f.path === "compose.ai.yml")!.content;
    expect(yml).toContain(OLLAMA_IMAGE);
    expect(yml).toContain("OKE_AI_MODEL");
    expect(yml).toContain("qwen3.5:9b");
    expect(yml).toContain("127.0.0.1:11434:11434");
    expect(yml).not.toMatch(/ports:\s*\n\s*-\s*"?11434:11434"?/);
    expect(result.stackEnv.OKE_AI_URL).toBe("http://127.0.0.1:11434");
    const envText = formatStackEnv(result.stackEnv);
    expect(envText).toContain("# ── ai — local inference");
  });

  test("ai llama-cpp (default) emits /v1 URL and loopback-only publish", () => {
    const result = deriveInfrastructure({
      images: { ai: LLAMA_CPP_IMAGE },
      app: "skyport",
    });
    const yml = result.files.find((f) => f.path === "compose.ai.yml")!.content;
    expect(yml).toContain(LLAMA_CPP_IMAGE);
    expect(yml).toContain("127.0.0.1:8080:8080");
    expect(yml).not.toMatch(/ports:\s*\n\s*-\s*"?8080:8080"?/);
    expect(result.stackEnv.OKE_AI_URL).toBe("http://127.0.0.1:8080/v1");
  });

  test("ai vllm and sglang emit loopback publish + GPU deploy", () => {
    for (const [image, port, path] of [
      [VLLM_IMAGE, 8000, "compose.ai.yml"],
      [SGLANG_IMAGE, 30000, "compose.ai.yml"],
    ] as const) {
      const result = deriveInfrastructure({ images: { ai: image }, app: "skyport" });
      const yml = result.files.find((f) => f.path === path)!.content;
      expect(yml).toContain(`127.0.0.1:${port}:${port}`);
      expect(yml).toContain("nvidia");
      expect(result.stackEnv.OKE_AI_URL).toBe(`http://127.0.0.1:${port}/v1`);
    }
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

  test("opt-in caddy proxy emits Caddyfile and unpublishes app ports", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:16",
        proxy: "caddy:2-alpine",
      },
      credentials: { "store.sql": fixedCreds["store.sql"] },
      app: "skyport",
    });
    const base = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(base).toContain("app:");
    expect(base).not.toContain("6530:6530");
    expect(base).not.toContain("proxy:");
    expect(base).toContain("store-sql");
    expect(base).not.toMatch(/depends_on:[\s\S]*proxy/);

    const proxyYml = result.files.find((f) => f.path === "compose.proxy.yml")!.content;
    expect(proxyYml).toContain("caddy:2-alpine");
    expect(proxyYml).toContain("80:80");
    expect(proxyYml).toContain("443:443");
    expect(proxyYml).toContain("./Caddyfile:/etc/caddy/Caddyfile:ro");

    const caddyfile = result.files.find((f) => f.path === "Caddyfile")!.content;
    expect(caddyfile).toContain("reverse_proxy app:6530");
    expect(result.stackEnv.OKE_PROXY_URL).toBe("https://127.0.0.1");
    expect(formatStackEnv(result.stackEnv)).toContain("# ── proxy — TLS terminator");
    expect(formatStackEnv(result.stackEnv)).toContain("# OKE_PROXY_HOST=localhost");
  });

  test("opt-in traefik proxy labels app and mounts socket only on socket-proxy", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:16",
        proxy: "traefik:v3.3",
      },
      credentials: { "store.sql": fixedCreds["store.sql"] },
      app: "skyport",
      prod: true,
    });
    const base = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(base).not.toContain("6530:6530");

    const proxyYml = result.files.find((f) => f.path === "compose.proxy.yml")!.content;
    expect(proxyYml).toContain("traefik:v3.3");
    expect(proxyYml).toContain(SOCKET_PROXY_IMAGE);
    expect(proxyYml).toContain(SOCKET_PROXY_SERVICE);
    expect(proxyYml).toContain("/var/run/docker.sock:/var/run/docker.sock:ro");
    expect(proxyYml).toContain("tcp://socket-proxy:2375");
    expect(proxyYml).toContain("traefik.enable");
    expect(proxyYml).toContain("traefik.http.routers.app.rule");
    expect(proxyYml).toContain("loadbalancer.server.port");
    // Raw socket must not be on the Traefik service itself.
    const traefikBlock = proxyYml.split("socket-proxy:")[0]!;
    expect(traefikBlock).toContain("traefik:v3.3");
    expect(traefikBlock).not.toContain("docker.sock");

    expect(result.files.some((f) => f.path === "Caddyfile")).toBe(false);
    expect(result.stackEnv.OKE_PROXY_URL).toBe("https://127.0.0.1");
    expect(result.composeFiles).toContain("compose.proxy.yml");
    expect(result.composeFiles).toContain("compose.prod.yml");
  });

  test("without proxy role, app still publishes 6530 (default unchanged)", () => {
    const result = deriveInfrastructure({
      images: { "store.sql": "postgres:16" },
      credentials: { "store.sql": fixedCreds["store.sql"] },
      app: "skyport",
    });
    const base = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(base).toContain("6530:6530");
    expect(result.files.some((f) => f.path === "compose.proxy.yml")).toBe(false);
    expect(result.stackEnv.OKE_PROXY_URL).toBeUndefined();
  });

  test("compose.all.yml merges every service from separate layer files", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:16",
        "store.kv": "redis:8-alpine",
        proxy: "traefik:v3.3",
      },
      credentials: {
        "store.sql": fixedCreds["store.sql"],
        "store.kv": fixedCreds["store.kv"],
      },
      app: "skyport",
      prod: true,
    });

    const allFile = result.files.find((f) => f.path === COMPOSE_ALL);
    expect(allFile).toBeDefined();
    const allYml = allFile!.content;
    const allServices = serviceNamesFromComposeYaml(allYml);

    const expected = new Set<string>();
    for (const f of result.files) {
      if (f.path === COMPOSE_ALL) continue;
      if (f.path !== "compose.yml" && !/^compose\..+\.yml$/.test(f.path)) continue;
      for (const name of serviceNamesFromComposeYaml(f.content)) {
        expected.add(name);
      }
    }

    expect(expected.size).toBeGreaterThan(0);
    for (const name of expected) {
      expect(allServices.has(name)).toBe(true);
    }
    // Companion + role services survive the merge (not dropped).
    expect(allServices.has("app")).toBe(true);
    expect(allServices.has("store-sql")).toBe(true);
    expect(allServices.has("store-kv")).toBe(true);
    expect(allServices.has("proxy")).toBe(true);
    expect(allServices.has(SOCKET_PROXY_SERVICE)).toBe(true);
    // Prod overlay fields land on app in the merged document.
    expect(allYml).toContain("/_/ready");
    expect(allYml).toContain("stop_grace_period");
    expect(allYml).toContain("update_config");
    // Still not in the layered `-f` list.
    expect(result.composeFiles).not.toContain(COMPOSE_ALL);
  });
});
