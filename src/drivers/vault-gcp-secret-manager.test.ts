/**
 * GCP Secret Manager bag — snapshot reads, write-through, peer gap.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import { openGcpSecretManagerBag } from "./vault-gcp-secret-manager.ts";
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

describe("gcp secret manager bag", () => {
  test("list + get snapshots every secret", async () => {
    const calls: Call[] = [];
    const bag = await openGcpSecretManagerBag({
      client: fakeClient({ STRIPE_KEY: "sk_live", DATABASE_URL: "postgres://x" }, calls),
    });
    expect([...bag.names()].sort()).toEqual(["DATABASE_URL", "STRIPE_KEY"]);
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
  });

  test("denied list with no declared names fails loud", async () => {
    const denied = new Error("denied");
    (denied as { code?: number }).code = 7;
    let failed: unknown;
    try {
      await openGcpSecretManagerBag({ client: fakeClient({}, [], { listError: denied }) });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "PERMISSION_DENIED")).toBe(true);
  });

  test("a failing read never carries the SDK error text", async () => {
    let failed: unknown;
    try {
      await openGcpSecretManagerBag({
        client: fakeClient({ A: "1" }, [], { getError: new Error("payload=sk_live_leak") }),
      });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    expect((failed as Error).message).not.toContain("sk_live_leak");
  });

  test("set writes through and close settles it", async () => {
    const calls: Call[] = [];
    const bag = await openGcpSecretManagerBag({ client: fakeClient({ A: "1" }, calls) });
    bag.set?.("A", "2");
    await bag.close?.();
    expect(calls).toContainEqual({ op: "put", name: "A", value: "2" });
  });

  test("missing project fails before the SDK import", async () => {
    const prevGoogle = process.env.GOOGLE_CLOUD_PROJECT;
    const prevGcloud = process.env.GCLOUD_PROJECT;
    delete process.env.GOOGLE_CLOUD_PROJECT;
    delete process.env.GCLOUD_PROJECT;
    let failed: unknown;
    try {
      await openGcpSecretManagerBag({});
    } catch (error) {
      failed = error;
    } finally {
      if (prevGoogle === undefined) delete process.env.GOOGLE_CLOUD_PROJECT;
      else process.env.GOOGLE_CLOUD_PROJECT = prevGoogle;
      if (prevGcloud === undefined) delete process.env.GCLOUD_PROJECT;
      else process.env.GCLOUD_PROJECT = prevGcloud;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    expect((failed as Error).message).toContain("OKE_VAULT_MOUNT");
  });

  test("missing optional peer reports the install command", async () => {
    let failed: unknown;
    try {
      await openGcpSecretManagerBag({ mount: "my-project" });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "MISSING_PEER")).toBe(true);
    expect((failed as Error).message).toContain("@google-cloud/secret-manager");
  });
});
