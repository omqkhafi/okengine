/**
 * OpenBao vault driver — KV v2 read + write/delete + fail-loud semantics.
 */

import { describe, expect, test } from "bun:test";
import { OpenBaoUnavailableError, openbaoVaultDriver } from "./vault-openbao.ts";

/** Scripted fetch: LIST + per-key GET, then capture writes/deletes. */
function fakeKv(
  seed: Record<string, string>,
  calls: { method: string; path: string; body?: string }[],
) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    calls.push({
      method,
      path: url.pathname + url.search,
      body: typeof init?.body === "string" ? init.body : undefined,
    });
    const mount = "/v1/secret";
    if (method === "GET" && url.pathname === `${mount}/metadata`) {
      return Response.json({ data: { keys: Object.keys(seed) } });
    }
    if (method === "GET" && url.pathname.startsWith(`${mount}/data/`)) {
      const name = decodeURIComponent(url.pathname.slice(`${mount}/data/`.length));
      if (!(name in seed)) return new Response("{}", { status: 404 });
      return Response.json({ data: { data: { value: seed[name] } } });
    }
    if (method === "POST" && url.pathname.startsWith(`${mount}/data/`)) {
      return new Response(null, { status: 204 });
    }
    if (method === "DELETE" && url.pathname.startsWith(`${mount}/data/`)) {
      return new Response(null, { status: 204 });
    }
    return new Response("{}", { status: 404 });
  }) as typeof globalThis.fetch;
}

describe("openbao vault driver", () => {
  test("LIST + GET loads all keys", async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const bag = await openbaoVaultDriver.open({
      url: "http://127.0.0.1:8200",
      token: "app-tok",
      fetch: fakeKv({ STRIPE_KEY: "sk_live", DATABASE_URL: "postgres://x" }, calls),
    });
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
    expect([...bag.names()].sort()).toEqual(["DATABASE_URL", "STRIPE_KEY"]);
  });

  test("set POSTs KV v2 data payload", async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const bag = await openbaoVaultDriver.open({
      url: "http://127.0.0.1:8200",
      token: "app-tok",
      fetch: fakeKv({ STRIPE_KEY: "sk_live" }, calls),
    });
    bag.set?.("STRIPE_KEY", "sk_rotated");
    await Bun.sleep(0);
    const writeCall = calls.find((c) => c.method === "POST");
    expect(writeCall?.path).toBe("/v1/secret/data/STRIPE_KEY");
    expect(writeCall?.body).toBe(JSON.stringify({ data: { value: "sk_rotated" } }));
    expect(bag.get("STRIPE_KEY")).toBe("sk_rotated");
  });

  test("unreachable remote fails loud (no soft-empty bag)", async () => {
    let failed: unknown;
    try {
      await openbaoVaultDriver.open({
        url: "http://127.0.0.1:9",
        token: "app-tok",
        fetch: (async () => {
          throw new Error("connect ECONNREFUSED");
        }) as unknown as typeof globalThis.fetch,
      });
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeInstanceOf(OpenBaoUnavailableError);
  });

  test("sealed / 5xx on GET fails loud", async () => {
    const fetchFn = (async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("metadata")) return Response.json({ data: { keys: ["STRIPE_KEY"] } });
      return new Response("sealed", { status: 503 });
    }) as typeof globalThis.fetch;
    let failed: unknown;
    try {
      await openbaoVaultDriver.open({ url: "http://127.0.0.1:8200", token: "t", fetch: fetchFn });
    } catch (err) {
      failed = err;
    }
    expect(failed).toBeInstanceOf(OpenBaoUnavailableError);
  });
});
