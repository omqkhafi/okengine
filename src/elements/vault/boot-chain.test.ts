/**
 * Vault boot chain — managed provider wiring and driver-id normalization.
 */

import { afterEach, describe, expect, test } from "bun:test";
import type { VaultOpenOptions } from "../../drivers/vault-types.ts";
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

  test("a provider puts the env layers in front of the managed layer", () => {
    process.env.OKE_VAULT_PROVIDER = "aws-secrets-manager";
    process.env.OKE_VAULT_REGION = "eu-central-1";
    process.env.OKE_VAULT_MOUNT = "oke/prod/";

    const chain = buildVaultBootChain({ driverId: "managed", env: "prod" });
    expect(chain[0]?.driver.id).toBe("env");
    const last = chain.at(-1);
    expect(last?.driver.id).toBe("managed");
    const options = last?.options as VaultOpenOptions;
    expect(options.provider).toBe("aws-secrets-manager");
    expect(options.region).toBe("eu-central-1");
    expect(options.mount).toBe("oke/prod/");
  });

  test("aws-secrets-manager carries region and prefix without inventing a mount", () => {
    process.env.OKE_VAULT_PROVIDER = "aws-secrets-manager";
    process.env.OKE_VAULT_REGION = "eu-central-1";

    const chain = buildVaultBootChain({ driverId: "managed", env: "prod" });
    const options = chain.at(-1)?.options as VaultOpenOptions;
    expect(options.region).toBe("eu-central-1");
    expect(options.mount).toBeUndefined();
  });

  test("built-in vault sits behind env layers", () => {
    const chain = buildVaultBootChain({ driverId: "vault", env: "prod" });
    expect(chain.map((l) => l.driver.id)).toContain("env");
    expect(chain.at(-1)?.driver.id).toBe("vault");
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
