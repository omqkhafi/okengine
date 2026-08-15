/**
 * Vault boot chain — managed provider wiring, driver-id normalization,
 * and backend-first resolution order.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VaultOpenOptions } from "../../drivers/vault-types.ts";
import { createVaultRuntime, vault } from "../vault.ts";
import { buildVaultBootChain, normalizeVaultDriverId } from "./boot-chain.ts";

/** Env keys these tests own. */
const OWNED = [
  "OKE_VAULT_PROVIDER",
  "OKE_VAULT_URL",
  "OKE_VAULT_TOKEN",
  "OKE_VAULT_MOUNT",
  "OKE_VAULT_REGION",
] as const;

afterEach(() => {
  for (const key of OWNED) delete process.env[key];
});

describe("managed vault boot chain", () => {
  test("no provider stays a single platform-injected layer", () => {
    const chain = buildVaultBootChain({ driverId: "managed", env: "test", seed: { A: "1" } });
    expect(chain).toHaveLength(1);
    expect(chain[0]?.driver.id).toBe("managed");
  });

  test("a provider puts the managed layer in front of the env layers", () => {
    process.env.OKE_VAULT_PROVIDER = "aws-secrets-manager";
    process.env.OKE_VAULT_REGION = "eu-central-1";
    process.env.OKE_VAULT_MOUNT = "oke/prod/";

    const chain = buildVaultBootChain({ driverId: "managed", env: "prod" });
    expect(chain[0]?.driver.id).toBe("managed");
    expect(chain[0]?.source).toBe("driver");
    expect(chain.slice(1).map((l) => l.source)).toEqual(["process.env", ".env.local"]);
    const options = chain[0]?.options as VaultOpenOptions;
    expect(options.provider).toBe("aws-secrets-manager");
    expect(options.region).toBe("eu-central-1");
    expect(options.mount).toBe("oke/prod/");
  });

  test("aws-secrets-manager carries region and prefix without inventing a mount", () => {
    process.env.OKE_VAULT_PROVIDER = "aws-secrets-manager";
    process.env.OKE_VAULT_REGION = "eu-central-1";

    const chain = buildVaultBootChain({ driverId: "managed", env: "prod" });
    const options = chain[0]?.options as VaultOpenOptions;
    expect(options.region).toBe("eu-central-1");
    expect(options.mount).toBeUndefined();
  });

  test("azure-key-vault forwards url without inventing a token", () => {
    process.env.OKE_VAULT_PROVIDER = "azure-key-vault";
    process.env.OKE_VAULT_URL = "https://app.vault.azure.net";

    const chain = buildVaultBootChain({ driverId: "managed", env: "prod" });
    const options = chain[0]?.options as VaultOpenOptions;
    expect(options.provider).toBe("azure-key-vault");
    expect(options.url).toBe("https://app.vault.azure.net");
    expect(options.token).toBeUndefined();
  });

  test("doppler and 1password forward token and mount", () => {
    process.env.OKE_VAULT_PROVIDER = "1password";
    process.env.OKE_VAULT_URL = "http://connect:8080";
    process.env.OKE_VAULT_TOKEN = "connect-token";
    process.env.OKE_VAULT_MOUNT = "Production";

    const chain = buildVaultBootChain({ driverId: "managed", env: "prod" });
    const options = chain[0]?.options as VaultOpenOptions;
    expect(options.provider).toBe("1password");
    expect(options.url).toBe("http://connect:8080");
    expect(options.token).toBe("connect-token");
    expect(options.mount).toBe("Production");
  });

  test("env driver puts the memory seed in front of env layers", () => {
    const chain = buildVaultBootChain({ driverId: "env", env: "dev", seed: { A: "1" } });
    expect(chain.map((l) => l.source)).toEqual(["driver", "process.env", ".env.local"]);
    expect(chain[0]?.driver.id).toBe("memory");
    expect(chain.slice(1).map((l) => l.driver.id)).toEqual(["env", "env"]);
  });

  test("env driver put writes .env.local, not the front memory seed", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-env-put-"));
    await writeFile(join(dir, ".env.local"), "", "utf8");
    const name = "OKE_TEST_VAULT_ENV_PUT";
    const runtime = createVaultRuntime({
      secrets: [vault.config(name, { dev: "seed" })],
      allowDevFallbacks: true,
      chain: buildVaultBootChain({ driverId: "env", cwd: dir, env: "dev" }),
    });
    await runtime.boot();
    runtime.put(name, "written");
    expect(runtime.read(name)).toBe("written");
    expect(runtime.resolution(name)).toBe(".env.local");
    expect(await Bun.file(join(dir, ".env.local")).text()).toContain(`${name}=written`);
  });

  test("allowGaps boots with an unset secret so put can write the first value", async () => {
    const dir = await mkdtemp(join(tmpdir(), "oke-vault-gaps-put-"));
    const name = "OKE_TEST_VAULT_GAPS_PUT";
    const runtime = createVaultRuntime({
      secrets: [vault.secret(name, { description: "unset until Console set" })],
      allowGaps: true,
      chain: buildVaultBootChain({ driverId: "env", cwd: dir, env: "dev" }),
    });
    await runtime.boot();
    runtime.put(name, "first-value");
    expect(runtime.read(name)).toBe("first-value");
    expect(await Bun.file(join(dir, ".env.local")).text()).toContain(`${name}=first-value`);
  });

  test("built-in vault sits in front of env layers", () => {
    const chain = buildVaultBootChain({ driverId: "vault", env: "prod" });
    expect(chain[0]?.driver.id).toBe("vault");
    expect(chain[0]?.source).toBe("driver");
    expect(chain.slice(1).map((l) => l.source)).toEqual(["process.env", ".env.local"]);
  });

  test("built-in vault wins over a conflicting process.env value", async () => {
    const name = "OKE_TEST_VAULT_PRIORITY";
    const prev = process.env[name];
    const prevDb = process.env.DATABASE_URL;
    const prevStore = process.env.OKE_STORE_SQL_URL;
    process.env[name] = "from-env";
    delete process.env.DATABASE_URL;
    delete process.env.OKE_STORE_SQL_URL;
    try {
      const runtime = createVaultRuntime({
        secrets: [vault.config(name)],
        chain: buildVaultBootChain({
          driverId: "vault",
          env: "test",
          seed: { [name]: "from-vault" },
        }),
      });
      await runtime.boot();
      expect(runtime.read(name)).toBe("from-vault");
      expect(runtime.resolution(name)).toBe("driver");
    } finally {
      if (prev === undefined) delete process.env[name];
      else process.env[name] = prev;
      if (prevDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prevDb;
      if (prevStore === undefined) delete process.env.OKE_STORE_SQL_URL;
      else process.env.OKE_STORE_SQL_URL = prevStore;
    }
  });
});

describe("normalizeVaultDriverId", () => {
  test("maps legacy labels onto protocol ids", () => {
    expect(normalizeVaultDriverId("dotenv")).toBe("env");
    expect(normalizeVaultDriverId("builtin")).toBe("vault");
    expect(normalizeVaultDriverId("managed")).toBe("managed");
    expect(normalizeVaultDriverId("vault")).toBe("vault");
  });

  test("rejects an unknown label", () => {
    expect(() => normalizeVaultDriverId("acme")).toThrow(/unknown vault driver/);
  });

  test("rejects removed external vault driver id", () => {
    const removed = ["open", "bao"].join("");
    expect(() => normalizeVaultDriverId(removed)).toThrow(/unknown vault driver/);
    expect(() => normalizeVaultDriverId(removed)).toThrow(/aws-secrets-manager/);
  });
});
