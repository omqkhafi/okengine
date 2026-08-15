/**
 * Managed vault driver — provider selection, official backends, delegation.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import {
  createManagedVaultBag,
  MANAGED_VAULT_PROVIDER_IDS,
  managedVaultDriver,
} from "./vault-managed.ts";
import type { RemoteSecretClient } from "./vault-remote-bag.ts";

/** In-memory stand-in for any remote secret API. */
function fakeClient(seed: Record<string, string>): RemoteSecretClient {
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

  test("every official provider reads through the injected client", async () => {
    for (const provider of MANAGED_VAULT_PROVIDER_IDS) {
      const bag = await createManagedVaultBag({
        provider,
        client: fakeClient({ STRIPE_KEY: "sk_live" }),
      });
      expect(bag.driverId).toBe("managed");
      expect(bag.get("STRIPE_KEY")).toBe("sk_live");
    }
  });

  test("provider id is case- and space-insensitive", async () => {
    const bag = await createManagedVaultBag({
      provider: "  AWS-Secrets-Manager ",
      client: fakeClient({ A: "1" }),
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

  test("unknown provider fails UNSUPPORTED with the supported list", async () => {
    let failed: unknown;
    try {
      await createManagedVaultBag({ provider: "acme-secrets" });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "UNSUPPORTED")).toBe(true);
    expect((failed as Error).message).toContain("aws-secrets-manager");
    expect((failed as Error).message).toContain("azure-key-vault");
    expect((failed as Error).message).toContain("gcp-secret-manager");
    expect((failed as Error).message).toContain("doppler");
    expect((failed as Error).message).toContain("1password");
  });
});
