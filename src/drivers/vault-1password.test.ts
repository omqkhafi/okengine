/**
 * 1Password Connect bag — snapshot reads, write-through, vault resolve, fetch.
 */

import { describe, expect, test } from "bun:test";
import { isVaultError } from "../elements/vault/errors.ts";
import { openOnePasswordBag } from "./vault-1password.ts";
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

/** One Connect item in the fake server. */
interface FakeItem {
  id: string;
  title: string;
  fields: { id: string; type: string; label: string; value: string }[];
}

/**
 * Fake Connect API over `fetch`.
 *
 * @param vaultName - Vault displayed name
 * @param items - Mutable item list
 */
function fakeConnectFetch(vaultName: string, items: FakeItem[]): typeof fetch {
  return (async (input, init) => {
    const url = String(input);
    const method = (init?.method ?? "GET").toUpperCase();
    const body = typeof init?.body === "string" ? init.body : undefined;

    if (url.endsWith("/v1/vaults") && method === "GET") {
      return json([{ id: "vault-1", name: vaultName }]);
    }
    if (url.endsWith("/items") && method === "GET") {
      return json(items.map(({ id, title }) => ({ id, title })));
    }
    if (url.endsWith("/items") && method === "POST" && body !== undefined) {
      const parsed = JSON.parse(body) as {
        title: string;
        fields?: FakeItem["fields"];
      };
      items.push({
        id: `item-${items.length + 1}`,
        title: parsed.title,
        fields: parsed.fields ?? [],
      });
      return json({ id: `item-${items.length}` }, 201);
    }

    const itemMatch = /\/items\/([^/?#]+)$/.exec(url);
    if (itemMatch) {
      const id = decodeURIComponent(itemMatch[1] ?? "");
      const index = items.findIndex((item) => item.id === id);
      if (method === "GET") {
        const item = items[index];
        return item === undefined ? new Response("", { status: 404 }) : json(item);
      }
      if (method === "PUT" && body !== undefined && index !== -1) {
        const parsed = JSON.parse(body) as FakeItem;
        items[index] = { ...items[index]!, ...parsed, id };
        return json(items[index]);
      }
      if (method === "DELETE") {
        if (index !== -1) items.splice(index, 1);
        return new Response("", { status: 204 });
      }
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
}

/**
 * JSON response helper.
 *
 * @param value - Body
 * @param status - HTTP status
 */
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("1password connect vault bag", () => {
  test("injected client snapshots secrets", async () => {
    const bag = await openOnePasswordBag({ client: fakeClient({ STRIPE_KEY: "sk_live" }) });
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
  });

  test("fetch list + get + write-through + delete", async () => {
    const items: FakeItem[] = [
      {
        id: "item-1",
        title: "STRIPE_KEY",
        fields: [{ id: "credential", type: "CONCEALED", label: "credential", value: "sk_live" }],
      },
    ];
    const bag = await openOnePasswordBag({
      url: "http://connect:8080",
      token: "connect-token",
      mount: "Production",
      fetch: fakeConnectFetch("Production", items),
    });
    expect(bag.get("STRIPE_KEY")).toBe("sk_live");
    bag.set?.("STRIPE_KEY", "sk_new");
    bag.set?.("NEW_KEY", "fresh");
    await bag.close?.();
    expect(items.find((item) => item.title === "STRIPE_KEY")?.fields[0]?.value).toBe("sk_new");
    expect(items.find((item) => item.title === "NEW_KEY")?.fields[0]?.value).toBe("fresh");
    bag.delete?.("STRIPE_KEY");
    await bag.close?.();
    expect(items.find((item) => item.title === "STRIPE_KEY")).toBeUndefined();
  });

  test("unknown vault name fails without echoing secrets", async () => {
    let failed: unknown;
    try {
      await openOnePasswordBag({
        url: "http://connect:8080",
        token: "connect-token",
        mount: "Missing",
        fetch: fakeConnectFetch("Production", []),
      });
    } catch (error) {
      failed = error;
    }
    expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    expect((failed as Error).message).toContain("Missing");
  });

  test("missing connection fields fail before fetch", async () => {
    for (const options of [
      {},
      { url: "http://connect:8080" },
      { url: "http://connect:8080", token: "t" },
    ]) {
      let failed: unknown;
      try {
        await openOnePasswordBag(options);
      } catch (error) {
        failed = error;
      }
      expect(isVaultError(failed, "BACKEND_ERROR")).toBe(true);
    }
  });
});
