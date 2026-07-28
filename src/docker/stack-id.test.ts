/**
 * Per-project stack identity.
 */

import { describe, expect, test } from "bun:test";
import {
  hostPortForInstance,
  instancePortOffset,
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
  test("offsets sql and kv into separate ranges", () => {
    const id = "abcd12";
    const sql = hostPortForInstance("store.sql", 5432, id);
    const kv = hostPortForInstance("store.kv", 6379, id);
    expect(sql).toBeGreaterThanOrEqual(15_000);
    expect(sql).toBeLessThan(16_000);
    expect(kv).toBeGreaterThanOrEqual(16_000);
    expect(kv).toBeLessThan(17_000);
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
    const id = "abcd12";
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
    expect(mailYml).toContain(`${8025 + n}:8025`);
    expect(mailYml).not.toContain("8025:8025");
    expect(filesYml).toContain(`${9001 + n}:9001`);
    expect(filesYml).not.toContain("9001:9001");
  });
});
