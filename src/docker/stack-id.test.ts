/**
 * Per-project stack identity.
 */

import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extraHostPortForInstance,
  hostPortForInstance,
  instancePortOffset,
  loadExistingStackControls,
  parseStackControls,
  parseStackCredentials,
  stackAppSlug,
  stackInstanceId,
} from "./stack-id.ts";
import { deriveInfrastructure } from "./derive.ts";

describe("stackInstanceId", () => {
  test("is stable for the same cwd and differs across paths", () => {
    const a = stackInstanceId("/tmp/oke-project-a");
    const b = stackInstanceId("/tmp/oke-project-a");
    const c = stackInstanceId("/tmp/oke-project-b");
    expect(a).toBe(b);
    expect(a).toHaveLength(6);
    expect(a).not.toBe(c);
  });

  test("stackAppSlug is dev-<id>", () => {
    const id = stackInstanceId("/tmp/oke-x");
    expect(stackAppSlug("/tmp/oke-x")).toBe(`dev-${id}`);
  });
});

describe("hostPortForInstance", () => {
  test("assigns built-in roles disjoint per-project ranges", () => {
    const id = "abcd12";
    const n = instancePortOffset(id);
    const sql = hostPortForInstance("store.sql", 5432, id);
    const kv = hostPortForInstance("store.kv", 6379, id);
    const files = hostPortForInstance("store.files", 9000, id);
    const filesConsole = extraHostPortForInstance("store.files", 9001, id);
    const email = hostPortForInstance("channel.email", 1025, id);
    const emailUi = extraHostPortForInstance("channel.email", 8025, id);
    expect([sql, kv, files, filesConsole, email, emailUi]).toEqual([
      15_000 + n,
      16_000 + n,
      18_000 + n,
      19_000 + n,
      20_000 + n,
      21_000 + n,
    ]);
  });
});

describe("loadExistingStackControls", () => {
  test("seeds OKE_AI_MODEL from .env.local when .env.docker omits it", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-stack-ai-"));
    await writeFile(join(dir, ".env.local"), "OKE_AI_MODEL=gemma4:e4b-q4_K_M\n", "utf8");
    const controls = await loadExistingStackControls(dir);
    expect(controls?.OKE_AI_MODEL).toBe("gemma4:e4b-q4_K_M");
  });

  test("prefers active OKE_AI_MODEL in docker/.env.docker over .env.local", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-stack-ai-"));
    await mkdir(join(dir, "docker"), { recursive: true });
    await writeFile(join(dir, "docker", ".env.docker"), "OKE_AI_MODEL=smollm2\n", "utf8");
    await writeFile(join(dir, ".env.local"), "OKE_AI_MODEL=gemma4:e4b-q4_K_M\n", "utf8");
    const controls = await loadExistingStackControls(dir);
    expect(controls?.OKE_AI_MODEL).toBe("smollm2");
  });
});

describe("parseStackCredentials", () => {
  test("reads OKE_* credential keys", () => {
    const text = `
OKE_STORE_SQL_USER=oke
OKE_STORE_SQL_PASSWORD=s3cret
OKE_STORE_SQL_DB=oke
OKE_STORE_KV_USER=oke
OKE_STORE_KV_PASSWORD=kvpass
OKE_STORE_KV_DB=oke
`;
    const creds = parseStackCredentials(text, ["store.sql", "store.kv"]);
    expect(creds["store.sql"]?.password).toBe("s3cret");
    expect(creds["store.kv"]?.password).toBe("kvpass");
  });

  test("reads service-specific S3 credentials and optional controls", () => {
    const text = `
S3_ACCESS_KEY_ID=files-key
S3_SECRET_ACCESS_KEY=files-secret
S3_REGION=eu-central-1
OKE_STORE_KV_MAXMEMORY=512mb
# SMTP_USER=commented-out
`;
    const creds = parseStackCredentials(text, ["store.files"]);
    expect(creds["store.files"]).toEqual({
      user: "files-key",
      password: "files-secret",
      database: "oke",
    });
    expect(parseStackControls(text)).toEqual({
      OKE_STORE_KV_MAXMEMORY: "512mb",
      S3_REGION: "eu-central-1",
    });
  });
});

describe("deriveInfrastructure instanceId", () => {
  test("unique app name and host ports land in stackEnv URLs", () => {
    const result = deriveInfrastructure({
      images: {
        "store.sql": "postgres:18-alpine",
        "store.kv": "redis:8-alpine",
      },
      app: "dev-abcdef",
      instanceId: "abcdef",
      includeApp: false,
      credentials: {
        "store.sql": {
          user: "oke",
          password: "stack-id-test-sql-password",
          database: "oke",
        },
        "store.kv": {
          user: "oke",
          password: "stack-id-test-kv-password",
          database: "oke",
        },
      },
    });
    const base = result.files.find((f) => f.path === "compose.yml")!.content;
    expect(base).toContain("oke-dev-abcdef");
    expect(result.stackEnv.DATABASE_URL).toMatch(/:15\d{3}\//);
    expect(result.stackEnv.REDIS_URL).toMatch(/:16\d{3}/);
  });

  test("offsets Mailpit UI and RustFS console so stacks do not share 8025/9001", () => {
    // Regression: offset 975 previously mapped Mailpit's 8025 UI onto RustFS's 9000 API.
    const id = "a3f791";
    const n = instancePortOffset(id);
    const result = deriveInfrastructure({
      images: {
        "channel.email": "axllent/mailpit:v1.22.3",
        "store.files": "rustfs/rustfs:1.0.0-beta.11",
      },
      app: `dev-${id}`,
      instanceId: id,
      includeApp: false,
      credentials: {
        "channel.email": {
          user: "oke",
          password: "stack-id-test-mail-password",
          database: "oke",
        },
        "store.files": {
          user: "oke",
          password: "stack-id-test-files-password",
          database: "oke",
        },
      },
    });
    const mailYml = result.files.find((f) => f.path === "compose.channel.email.yml")!.content;
    const filesYml = result.files.find((f) => f.path === "compose.store.files.yml")!.content;
    expect(mailYml).toContain(`${20_000 + n}:1025`);
    expect(mailYml).toContain(`${21_000 + n}:8025`);
    expect(mailYml).not.toContain("8025:8025");
    expect(filesYml).toContain(`${18_000 + n}:9000`);
    expect(filesYml).toContain(`${19_000 + n}:9001`);
    expect(filesYml).not.toContain("9001:9001");
    expect(mailYml).not.toContain("9000:8025");
  });
});
