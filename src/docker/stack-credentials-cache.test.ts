/**
 * Home-dir stack credential cache — reuse passwords after a project wipe.
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  clearStackCredentialsCache,
  instanceIdFromComposeProject,
  mergeStackCredentials,
  readStackCredentialsCacheText,
  stackCredentialsCachePath,
  writeStackCredentialsCache,
} from "./stack-credentials-cache.ts";
import { parseStackCredentials } from "./stack-id.ts";

describe("instanceIdFromComposeProject", () => {
  test("reads the 6-hex id from oke-dev-*", () => {
    expect(instanceIdFromComposeProject("oke-dev-c05831")).toBe("c05831");
    expect(instanceIdFromComposeProject("oke-other")).toBeUndefined();
  });
});

describe("mergeStackCredentials", () => {
  test("cache fills roles the project file lacks; local wins collisions", () => {
    expect(mergeStackCredentials(undefined, undefined)).toBeUndefined();
    const cached = {
      "store.sql": { user: "oke", password: "old-sql", database: "oke" },
      "store.kv": { user: "oke", password: "old-kv", database: "oke" },
    };
    const local = {
      "store.sql": { user: "oke", password: "new-sql", database: "oke" },
    };
    expect(mergeStackCredentials(undefined, cached)).toEqual(cached);
    expect(mergeStackCredentials(local, undefined)).toEqual(local);
    expect(mergeStackCredentials(local, cached)).toEqual({
      "store.sql": local["store.sql"]!,
      "store.kv": cached["store.kv"]!,
    });
  });
});

describe("stack credentials cache files", () => {
  test("write / load / clear under an injected home", async () => {
    const home = mkdtempSync(join(tmpdir(), "oke-stack-cache-"));
    const id = "abcdef";
    expect(stackCredentialsCachePath(id, home)).toBe(join(home, ".oke", "stacks", "abcdef.env"));
    await writeStackCredentialsCache(
      id,
      {
        OKE_STORE_SQL_USER: "oke",
        OKE_STORE_SQL_PASSWORD: "cached-sql",
        OKE_STORE_SQL_DB: "oke",
      },
      home,
    );
    const text = await readStackCredentialsCacheText(id, home);
    expect(parseStackCredentials(text ?? "", ["store.sql"])["store.sql"]?.password).toBe(
      "cached-sql",
    );
    await clearStackCredentialsCache(id, home);
    expect(await readStackCredentialsCacheText(id, home)).toBeUndefined();
  });
});
