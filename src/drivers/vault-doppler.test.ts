/**
 * Doppler bag — snapshot reads, write-through, token/mount, fetch.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import { openDopplerBag } from "./vault-doppler.ts";
import type { RemoteSecretClient } from "./vault-remote-bag.ts";

/** In-memory stand-in for the REST client. */
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

/** Recorded HTTP call. */
interface HttpCall {
  readonly method: string;
  readonly url: string;
  readonly body?: string;
}

/**
 * Fake Doppler API over `fetch`.
 *
 * @param store - Secret map
 * @param calls - Recorded requests
 */
function fakeFetch(store: Map<string, string>, calls: HttpCall[]): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;
    calls.push({ method, url, ...(body === undefined ? {} : { body }) });
    if (method === "GET") {
      const secrets: Record<string, { raw: string }> = {};
      for (const [name, value] of store) secrets[name] = { raw: value };
      return new Response(JSON.stringify({ secrets }), { status: 200 });
    }
    if (method === "POST" && body !== undefined) {
      const parsed = JSON.parse(body) as { secrets?: Record<string, string | null> };
      for (const [name, value] of Object.entries(parsed.secrets ?? {})) {
        if (value === null) store.delete(name);
        else store.set(name, value);
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 });
    }
    return new Response("", { status: 500 });
  }) as typeof fetch;
}

describe("doppler vault bag", () => {
  test("injected client snapshots secrets", async () => {
    const bag = await openDopplerBag({ client: fakeClient({ STRIPE_KEY: "sk_live" }) });
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
  });

  test("fetch list + write-through", async () => {
    const store = new Map([["A", "1"]]);
    const calls: HttpCall[] = [];
    const bag = await openDopplerBag({
      token: "dp.st.test",
      fetch: fakeFetch(store, calls),
    });
    expect(bag.get("A")).toBe("1");
    bag.set?.("A", "2");
    bag.delete?.("A");
    await bag.close?.();
    expect(store.has("A")).toBe(false);
    expect(calls.some((c) => c.method === "GET")).toBe(true);
    expect(calls.some((c) => c.method === "POST")).toBe(true);
  });

  test("personal-token mount becomes project/config query", async () => {
    const calls: HttpCall[] = [];
    await openDopplerBag({
      token: "dp.pt.test",
      mount: "app/prd",
      fetch: fakeFetch(new Map([["A", "1"]]), calls),
    });
    expect(calls[0]?.url).toContain("project=app");
    expect(calls[0]?.url).toContain("config=prd");
  });

  test("malformed mount fails INVALID_PATH", async () => {
    let failed: unknown;
    try {
      await openDopplerBag({ token: "dp.st.test", mount: "only-project" });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "INVALID_PATH")).toBe(true);
  });

  test("missing token fails before fetch", async () => {
    let failed: unknown;
    try {
      await openDopplerBag({});
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    expect((failed as Error).message).toContain("OKE_VAULT_TOKEN");
  });

  test("401 is PERMISSION_DENIED and never echoes the body", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ messages: ["token=sk_live_leak"] }), {
        status: 401,
      })) as unknown as typeof fetch;
    let failed: unknown;
    try {
      await openDopplerBag({ token: "bad", fetch: fetchFn });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "PERMISSION_DENIED")).toBe(true);
    expect((failed as Error).message).not.toContain("sk_live_leak");
  });
});
