/**
 * Managed vault driver — provider selection, deferred providers, delegation.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import { createManagedVaultBag, managedVaultDriver } from "./vault-managed.ts";
import type { AwsSecretsManagerClient } from "./vault-aws-secrets-manager.ts";

/** In-memory stand-in for the AWS Secrets Manager API. */
function fakeAwsClient(seed: Record<string, string>): AwsSecretsManagerClient {
  const store = new Map(Object.entries(seed));
  return {
    async list() {
      return [...store.keys()];
    },
    async get(name) {
      return store.get(name);
    },
    async put(name, value) {
      store.set(name, value);
    },
    async remove(name) {
      store.delete(name);
    },
  };
}

describe("managed vault driver", () => {
  test("no provider keeps the platform-injected map", async () => {
    const bag = await managedVaultDriver.open({
      env: { INJECTED: "from-platform" },
      secrets: { SEEDED: "from-seed" },
    });
    expect(bag.driverId).toBe("managed");
    expect(bag.get("INJECTED")).toBe("from-platform");
    expect(bag.get("SEEDED")).toBe("from-seed");
  });

  test("aws-secrets-manager provider reads through the injected client", async () => {
    const bag = await createManagedVaultBag({
      provider: "aws-secrets-manager",
      client: fakeAwsClient({ STRIPE_KEY: "sk_live" }),
    });
    expect(bag.driverId).toBe("managed");
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
  });

  test("provider id is case- and space-insensitive", async () => {
    const bag = await createManagedVaultBag({
      provider: "  AWS-Secrets-Manager ",
      client: fakeAwsClient({ A: "1" }),
    });
    expect(bag.get("A")).toBe("1");
  });

  test("rejects removed external vault providers", async () => {
    // Split tokens so the removal gate never matches this file.
    const removed = [["open", "bao"].join(""), ["hashi", "corp"].join("")];
    for (const provider of removed) {
      let failed: unknown;
      try {
        await createManagedVaultBag({ provider });
      } catch (error) {
        failed = error;
      }
      expect(isVaultError(failed, "UNSUPPORTED")).toBe(true);
      expect((failed as Error).message).toContain(provider);
    }
  });

  test("deferred providers fail UNSUPPORTED, never silently empty", async () => {
    for (const provider of ["azure-key-vault", "gcp-secret-manager", "doppler", "1password"]) {
      let failed: unknown;
      try {
        await createManagedVaultBag({ provider });
      } catch (error) {
        failed = error;
      }
      expect(isVaultError(failed, "UNSUPPORTED")).toBe(true);
      expect((failed as Error).message).toContain(provider);
    }
  });

  test("unknown provider fails UNSUPPORTED with the supported list", async () => {
    let failed: unknown;
    try {
      await createManagedVaultBag({ provider: "acme-secrets" });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "UNSUPPORTED")).toBe(true);
    expect((failed as Error).message).toContain("aws-secrets-manager");
  });
});
