/**
 * Azure Key Vault bag — snapshot reads, write-through, name mapping, peer gap.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import { fromAzureName, openAzureKeyVaultBag, toAzureName } from "./vault-azure-key-vault.ts";
import type { RemoteSecretClient } from "./vault-remote-bag.ts";

/** One recorded call against the fake API. */
interface Call {
  readonly op: "list" | "get" | "put" | "remove";
  readonly name?: string;
  readonly value?: string;
}

/** Fake API options — which operations should reject. */
interface FakeOptions {
  readonly listError?: Error;
  readonly getError?: Error;
  readonly putError?: Error;
}

/** In-memory stand-in for the SDK-backed client. */
function fakeClient(
  seed: Record<string, string>,
  calls: Call[],
  options: FakeOptions = {},
): RemoteSecretClient {
  const store = new Map(Object.entries(seed));
  return {
    async list() {
      calls.push({ op: "list" });
      if (options.listError) throw options.listError;
      return [...store.keys()];
    },
    async get(name) {
      calls.push({ op: "get", name });
      if (options.getError) throw options.getError;
      return store.get(name);
    },
    async put(name, value) {
      calls.push({ op: "put", name, value });
      if (options.putError) throw options.putError;
      store.set(name, value);
    },
    async remove(name) {
      calls.push({ op: "remove", name });
      store.delete(name);
    },
  };
}

describe("azure key vault bag", () => {
  test("list + get snapshots every secret", async () => {
    const calls: Call[] = [];
    const bag = await openAzureKeyVaultBag({
      client: fakeClient({ STRIPE_KEY: "sk_live", DATABASE_URL: "postgres://x" }, calls),
    });
    expect([...bag.names()].sort()).toEqual(["DATABASE_URL", "STRIPE_KEY"]);
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
    expect(calls.filter((c) => c.op === "get")).toHaveLength(2);
  });

  test("denied list falls back to the declared names", async () => {
    const denied = new Error("denied");
    denied.name = "Forbidden";
    const bag = await openAzureKeyVaultBag({
      secrets: { STRIPE_KEY: "seed" },
      client: fakeClient({ STRIPE_KEY: "sk_live" }, [], { listError: denied }),
    });
    expect(bag.names()).toEqual(["STRIPE_KEY"]);
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
  });

  test("denied list with no declared names fails loud", async () => {
    const denied = new Error("denied");
    denied.name = "Forbidden";
    let failed: unknown;
    try {
      await openAzureKeyVaultBag({ client: fakeClient({}, [], { listError: denied }) });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "PERMISSION_DENIED")).toBe(true);
  });

  test("a failing read never carries the SDK error text", async () => {
    let failed: unknown;
    try {
      await openAzureKeyVaultBag({
        client: fakeClient({ A: "1" }, [], { getError: new Error("value=sk_live_leak") }),
      });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    expect((failed as Error).message).not.toContain("sk_live_leak");
  });

  test("set writes through and close settles it", async () => {
    const calls: Call[] = [];
    const bag = await openAzureKeyVaultBag({ client: fakeClient({ A: "1" }, calls) });
    bag.set?.("A", "2");
    expect(bag.get("A")).toBe("2");
    await bag.close?.();
    expect(calls).toContainEqual({ op: "put", name: "A", value: "2" });
  });

  test("maps underscores to Azure-legal hyphens", () => {
    expect(toAzureName("STRIPE_KEY")).toBe("STRIPE-KEY");
    expect(fromAzureName("STRIPE-KEY")).toBe("STRIPE_KEY");
  });

  test("missing vault URI fails before the SDK import", async () => {
    let failed: unknown;
    try {
      await openAzureKeyVaultBag({});
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    expect((failed as Error).message).toContain("OKE_VAULT_URL");
  });

  test("missing optional peers report the install command", async () => {
    let failed: unknown;
    try {
      await openAzureKeyVaultBag({ url: "https://app.vault.azure.net" });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "MISSING_PEER")).toBe(true);
    expect((failed as Error).message).toContain("@azure/keyvault-secrets");
    expect((failed as Error).message).toContain("@azure/identity");
  });
});
