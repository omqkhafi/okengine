/**
 * AWS Secrets Manager bag — snapshot reads, write-through, fail-loud, peer gap.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import {
  openAwsSecretsManagerBag,
  type AwsSecretsManagerClient,
} from "./vault-aws-secrets-manager.ts";

/** One recorded call against the fake API. */
interface Call {
  readonly op: "list" | "get" | "put" | "remove";
  readonly name?: string;
  readonly value?: string;
}

/** Fake API options — which operations should reject, and how. */
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
): AwsSecretsManagerClient {
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

describe("aws secrets manager vault bag", () => {
  test("list + get snapshots every secret", async () => {
    const calls: Call[] = [];
    const bag = await openAwsSecretsManagerBag({
      client: fakeClient({ STRIPE_KEY: "sk_live", DATABASE_URL: "postgres://x" }, calls),
    });
    expect([...bag.names()].sort()).toEqual(["DATABASE_URL", "STRIPE_KEY"]);
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
    expect(calls.filter((c) => c.op === "get")).toHaveLength(2);
  });

  test("denied list falls back to the declared names", async () => {
    const calls: Call[] = [];
    const denied = new Error("denied");
    denied.name = "AccessDeniedException";
    const bag = await openAwsSecretsManagerBag({
      secrets: { STRIPE_KEY: "seed" },
      client: fakeClient({ STRIPE_KEY: "sk_live", OTHER: "nope" }, calls, { listError: denied }),
    });
    expect(bag.names()).toEqual(["STRIPE_KEY"]);
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
  });

  test("denied list with no declared names fails loud", async () => {
    const denied = new Error("denied");
    denied.name = "AccessDeniedException";
    let failed: unknown;
    try {
      await openAwsSecretsManagerBag({
        client: fakeClient({}, [], { listError: denied }),
      });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "PERMISSION_DENIED")).toBe(true);
  });

  test("a failing read is fatal, never a silently empty bag", async () => {
    let failed: unknown;
    try {
      await openAwsSecretsManagerBag({
        client: fakeClient({ A: "1" }, [], { getError: new Error("boom") }),
      });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
  });

  test("the authored message never carries the SDK error text", async () => {
    let failed: unknown;
    try {
      await openAwsSecretsManagerBag({
        client: fakeClient({ A: "1" }, [], { getError: new Error("SecretString=sk_live_leak") }),
      });
    } catch (error) {
      failed = error;
    }
    expect((failed as Error).message).not.toContain("sk_live_leak");
  });

  test("set writes through and close settles it", async () => {
    const calls: Call[] = [];
    const bag = await openAwsSecretsManagerBag({ client: fakeClient({ A: "1" }, calls) });
    bag.set?.("A", "2");
    expect(bag.get("A")).toBe("2");
    await bag.close?.();
    expect(calls).toContainEqual({ op: "put", name: "A", value: "2" });
  });

  test("delete removes locally and remotely", async () => {
    const calls: Call[] = [];
    const bag = await openAwsSecretsManagerBag({ client: fakeClient({ A: "1" }, calls) });
    expect(bag.delete?.("A")).toBe(true);
    expect(bag.get("A")).toBeUndefined();
    await bag.close?.();
    expect(calls).toContainEqual({ op: "remove", name: "A" });
  });

  test("a lost write surfaces at close instead of vanishing", async () => {
    const bag = await openAwsSecretsManagerBag({
      client: fakeClient({ A: "1" }, [], { putError: new Error("throttled") }),
    });
    bag.set?.("A", "2");
    let failed: unknown;
    try {
      await bag.close?.();
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
  });

  test("missing optional peer reports the install command", async () => {
    let failed: unknown;
    try {
      await openAwsSecretsManagerBag({ region: "us-east-1" });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "MISSING_PEER")).toBe(true);
    expect((failed as Error).message).toContain("@aws-sdk/client-secrets-manager");
  });
});
